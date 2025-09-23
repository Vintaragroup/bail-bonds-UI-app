import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useKpis,
  useTopByValue,
  usePerCounty,
  useCountyTrends,
  useNewToday,
  useRecent48to72,
} from '../hooks/dashboard';
import { useCaseStats, useCases } from '../hooks/cases';

// Always render these 5
const ALL_COUNTIES = ['brazoria', 'fortbend', 'galveston', 'harris', 'jefferson'];

const COUNTY_LABELS = {
  brazoria: 'Brazoria',
  fortbend: 'Fort Bend',
  galveston: 'Galveston',
  harris: 'Harris',
  jefferson: 'Jefferson',
};

const prettyCounty = (name) =>
  COUNTY_LABELS[name] || (name ? name.charAt(0).toUpperCase() + name.slice(1) : '');

const formatLabel = (text = '') =>
  text
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const safeDateLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
};

const isStalePull = (value) => {
  if (!value || value === '—') return true;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return ageHours >= STALE_PULL_THRESHOLD_HOURS;
};

const offenseText = (item = {}) => {
  if (item.offense) return item.offense;
  if (item.charge) return item.charge;
  if (Array.isArray(item.charges) && item.charges.length) {
    const first = item.charges[0];
    if (typeof first === 'string') return first;
    if (first?.description) return first.description;
    if (first?.offense) return first.offense;
    if (first?.charge) return first.charge;
  }
  return '';
};

const agencyText = (item = {}) =>
  item.agency || item.facility || item.agency_name || item.jail_name || '';

const toCaseId = (item = {}) => {
  const candidate =
    item.id ??
    item.case_id ??
    item.caseId ??
    item._id ??
    item.case_number ??
    item.booking_number ??
    item.bookingNumber ??
    null;
  return candidate != null ? String(candidate) : null;
};

const shapeSnapshotRow = (item, source, extras = {}) => {
  const caseId = toCaseId(item);
  const rawBooked =
    item.booking_date || item.bookedAt || item.booked_at || item.normalized_at || null;
  const booked = rawBooked instanceof Date ? rawBooked.toISOString().slice(0, 10) : rawBooked || '';
  return {
    caseId,
    key: caseId || `${source}-${item.person || item.name || item.full_name || Math.random()}`,
    name: item.name || item.person || item.full_name || 'Unknown',
    county: prettyCounty(item.county),
    booked,
    bondAmount: item.bond_amount ?? item.value ?? null,
    bondStatus: item.bond_status || (Number(item.bond_amount ?? item.value) ? 'numeric' : null),
    bondRaw: item.bond_raw || item.bond || item.bond_label || null,
    offense: offenseText(item),
    agency: agencyText(item),
    contacted: Boolean(item.contacted),
    lastContact: item.last_contact_at || item.last_contact || null,
    sex: item.sex || item.gender || null,
    race: item.race || null,
    category:
      source === 'top'
        ? item.category || null
        : item.crm_stage || item.stage || item.status || null,
    needsAttention: Boolean(item.needs_attention),
    attentionReasons: Array.isArray(item.attention_reasons) ? item.attention_reasons : [],
    source,
    ...extras,
  };
};

const SNAPSHOT_TABS = [
  { id: 'top', label: 'Top value' },
  { id: 'new', label: 'New 24h' },
  { id: 'recent', label: '48–72h' },
  { id: 'attention', label: 'Needs attention' },
];

const SNAPSHOT_CONTACT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'uncontacted', label: 'Uncontacted' },
  { id: 'contacted', label: 'Contacted' },
];

const SNAPSHOT_EMPTY_COPY = {
  top: 'No results for this window.',
  new: 'No bookings in this window.',
  recent: 'No results in the 48–72h window.',
  attention: 'No cases currently need manual attention.',
};

const COUNTY_SORT_OPTIONS = [
  { id: 'bond', label: 'Sort by bond' },
  { id: 'volume', label: 'Sort by volume' },
];

const STALE_PULL_THRESHOLD_HOURS = 12;

// Money formatting helper
const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString()}` : '$0';
};

// County key normalization helper
const normCountyKey = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/county/g, '')
    .replace(/[^a-z]/g, '');

// Render a bond amount or a status badge when the value is non-numeric.
function BondDisplay({ amount, status, raw }) {
  const v = Number(amount ?? 0);
  const isNumeric = Number.isFinite(v) && v > 0;

  if (status === 'numeric' || isNumeric) {
    return <div className="font-semibold">{money(v)}</div>;
  }

  // Map status -> label and tone
  const map = {
    refer_to_magistrate: { label: 'Refer to Magistrate', tone: 'warn' },
    summons: { label: 'Summons', tone: 'default' },
    unsecured: { label: 'Unsecured', tone: 'danger' },
    no_bond: { label: 'No bond', tone: 'default' },
    unknown_text: { label: 'Note', tone: 'default' },
  };

  const entry = map[status] || { label: String(status || 'Unknown'), tone: 'default' };

  const toneClasses = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-green-50 text-green-700',
    warn: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };

  return (
    <div>
      <span
        title={String(raw || '')}
        className={`inline-flex items-center rounded-md text-[11px] px-2 py-1 ${toneClasses[entry.tone]}`}
      >
        {entry.label}
      </span>
    </div>
  );
}

function MiniStackedBar({ new24, new48, new72 }) {
  const total = Math.max((new24 || 0) + (new48 || 0) + (new72 || 0), 0.0001);
  const p24 = (new24 / total) * 100;
  const p48 = (new48 / total) * 100;
  const p72 = (new72 / total) * 100;
  return (
    <div className="w-full">
      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-green-400 inline-block" style={{ width: `${p24}%` }} />
        <div className="h-full bg-amber-400 inline-block" style={{ width: `${p48}%` }} />
        <div className="h-full bg-red-400 inline-block" style={{ width: `${p72}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>24h: {new24 || 0}</span>
        <span>48h: {new48 || 0}</span>
        <span>72h: {new72 || 0}</span>
      </div>
    </div>
  );
}

function Sparkline({ values = [] }) {
  const width = 160, height = 36, pad = 2;
  if (!values.length) return <div className="h-9" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="block">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-blue-500"
      />
    </svg>
  );
}

function KpiCard({ label, value, sublabel, tone = 'default', to }) {
  const base = 'rounded-2xl border shadow-sm p-4 bg-white';
  const tones = {
    default: '',
    success: 'ring-1 ring-green-100',
    warn: 'ring-1 ring-amber-100',
    danger: 'ring-1 ring-red-100',
  };
  const content = (
    <div className={`${base} ${tones[tone]}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-xl font-bold text-slate-800 sm:text-2xl">{value}</div>
        {sublabel ? <div className="text-xs text-slate-500">{sublabel}</div> : null}
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function Panel({ title, subtitle, children, className = '', to, right }) {
  return (
    <section className={`bg-white rounded-2xl border shadow-sm p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {right}
          {to ? (
            <Link to={to} className="text-sm text-blue-600 hover:text-blue-700">
              View all
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function WindowSwitcher({ value, onChange }) {
  const btn =
    'px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700';
  return (
    <div className="inline-flex gap-1">
      {['24h', '48h', '72h'].map((w) => (
        <button
          key={w}
          className={btn}
          data-active={value === w}
          onClick={() => onChange(w)}
          type="button"
        >
          {w}
        </button>
      ))}
    </div>
  );
}

export default function DashboardScreen() {
  const navigate = useNavigate();

  // ── Queries
  const { data: kpiData, isLoading: kpisLoading } = useKpis();
  const [valueWindow, setValueWindow] = useState('24h'); // affects both Top10 and Bond Value panel
  const { data: top10, isLoading: topLoading } = useTopByValue(valueWindow, 10);
  const { data: perCounty, isLoading: perCountyLoading } = usePerCounty('today');
  const { data: countyTrends, isLoading: trendsLoading } = useCountyTrends(7);
  const { data: new24h, isLoading: new24Loading } = useNewToday('all');
  const { data: recent48to72, isLoading: recentLoading } = useRecent48to72(10);
  const { data: caseStats } = useCaseStats({ staleTime: 120_000 });
  const [snapshotTab, setSnapshotTab] = useState('top');
  const [snapshotFilters, setSnapshotFilters] = useState({
    top: 'all',
    new: 'all',
    recent: 'all',
    attention: 'all',
  });
  const setSnapshotFilter = (tab, value) =>
    setSnapshotFilters((prev) => ({
      ...prev,
      [tab]: value,
    }));
  const [countySort, setCountySort] = useState('bond');
  const [countyAttentionOnly, setCountyAttentionOnly] = useState(false);

  // ── Normalize
  const perCountyItems = useMemo(
    () => (Array.isArray(perCounty?.items) ? perCounty.items : []),
    [perCounty]
  );
  const perCountyMap = useMemo(() => {
    const m = new Map();
    perCountyItems.forEach((c) => {
      m.set(normCountyKey(c.county), c);
    });
    return m;
  }, [perCountyItems]);

  const top10Raw = useMemo(() => (Array.isArray(top10) ? top10 : []), [top10]);
  const topWindowUsed = top10Raw.length ? (top10Raw[0].window_used || valueWindow) : valueWindow;
  const topFallbackNotice = top10Raw.length > 0 && topWindowUsed !== valueWindow;
  const applyContactFilter = (list = [], filter = 'all') => {
    const arr = Array.isArray(list) ? list : [];
    if (filter === 'contacted') return arr.filter((item) => item.contacted);
    if (filter === 'uncontacted') return arr.filter((item) => !item.contacted);
    return arr;
  };
  const top10List = useMemo(
    () => applyContactFilter(top10Raw, snapshotFilters.top),
    [top10Raw, snapshotFilters.top]
  );
  const top10Counts = useMemo(() => {
    const contacted = top10Raw.filter((item) => item.contacted).length;
    return {
      total: top10Raw.length,
      contacted,
      uncontacted: top10Raw.length - contacted,
    };
  }, [top10Raw]);
  const attentionSummary = useMemo(() => {
    if (!caseStats) return null;
    const total = Number(caseStats?.totals?.cases || 0);
    const needs = Number(caseStats?.attention?.needsAttention || 0);
    const refer = Number(caseStats?.attention?.referToMagistrate || 0);
    const letter = Number(caseStats?.attention?.letterSuffix || 0);
    const missingDocs = Number(caseStats?.checklist?.casesMissingRequired || 0);
    return { total, needs, refer, letter, missingDocs };
  }, [caseStats]);
  const lastPullMap = useMemo(() => {
    const map = new Map();
    (caseStats?.perCountyLastPull || kpiData?.perCountyLastPull || []).forEach((item) => {
      if (!item?.county) return;
      map.set(normCountyKey(item.county), item.lastPull || item.finishedAt || '—');
    });
    return map;
  }, [caseStats, kpiData]);
  const new24Raw = useMemo(() => {
    if (Array.isArray(new24h?.items)) return new24h.items;
    if (Array.isArray(new24h)) return new24h;
    return [];
  }, [new24h]);

  const recentRaw = useMemo(() => {
    if (Array.isArray(recent48to72?.items)) return recent48to72.items;
    if (Array.isArray(recent48to72)) return recent48to72;
    return [];
  }, [recent48to72]);

  const {
    data: attentionData,
    isLoading: attentionLoading,
  } = useCases(
    { attention: true, limit: 25, sortBy: 'bond_amount', order: 'desc' },
    { staleTime: 60_000 }
  );

  const attentionRaw = useMemo(() => {
    if (Array.isArray(attentionData?.items)) return attentionData.items;
    if (Array.isArray(attentionData)) return attentionData;
    return [];
  }, [attentionData]);

  const attentionList = useMemo(
    () => applyContactFilter(attentionRaw, snapshotFilters.attention),
    [attentionRaw, snapshotFilters.attention]
  );

  const attentionCounts = useMemo(() => {
    const contacted = attentionRaw.filter((item) => item.contacted).length;
    const needs = attentionRaw.filter((item) => item.needs_attention).length;
    return {
      total: attentionRaw.length,
      contacted,
      uncontacted: attentionRaw.length - contacted,
      needs,
    };
  }, [attentionRaw]);

  const newSummary = useMemo(
    () =>
      new24h?.summary || {
        total: new24Raw.length,
        contacted: 0,
        uncontacted: new24Raw.length,
      },
    [new24h, new24Raw.length]
  );
  const recentSummary = useMemo(
    () =>
      recent48to72?.summary || {
        totalCount: recentRaw.length,
        contacted: 0,
        uncontacted: recentRaw.length,
      },
    [recent48to72, recentRaw.length]
  );

  const new24List = useMemo(
    () => applyContactFilter(new24Raw, snapshotFilters.new),
    [new24Raw, snapshotFilters.new]
  );
  const recentList = useMemo(
    () => applyContactFilter(recentRaw, snapshotFilters.recent),
    [recentRaw, snapshotFilters.recent]
  );

  const recentBreakdown = useMemo(() => {
    const now = Date.now();
    const total = recentList.length;
    let in48 = 0;
    let in72 = 0;

    const toHoursFromNow = (value) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00Z`
        : value;
      const parsed = new Date(isoLike);
      if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
      return (now - parsed.getTime()) / (1000 * 60 * 60);
    };

    recentList.forEach((item) => {
      const booked = item.booking_date || item.bookedAt || item.booked_at;
      const hours = toHoursFromNow(booked);
      if (hours >= 24 && hours < 48) in48 += 1;
      if (hours >= 48 && hours <= 72) in72 += 1;
    });

    return { total, in48, in72 };
  }, [recentList]);

  const snapshotRowsByTab = useMemo(
    () => ({
      top: top10List.map((item, index) =>
        shapeSnapshotRow(item, 'top', { key: item.id || `top-${index}` })
      ),
      new: new24List.map((item, index) =>
        shapeSnapshotRow(item, 'new', {
          key: item.id || `new-${index}`,
          windowLabel: '24h',
        })
      ),
      recent: recentList.map((item, index) =>
        shapeSnapshotRow(item, 'recent', {
          key: item.id || `recent-${index}`,
          windowLabel: '48–72h',
        })
      ),
      attention: attentionList.map((item, index) =>
        shapeSnapshotRow(item, 'attention', {
          key: item.id || item._id || `attention-${index}`,
          windowLabel: 'Attention',
        })
      ),
    }),
    [top10List, new24List, recentList, attentionList]
  );

  const snapshotSummaries = useMemo(
    () => ({
      top: {
        total: top10Counts.total,
        contacted: top10Counts.contacted,
        uncontacted: top10Counts.uncontacted,
        fallbackWindow: topFallbackNotice ? topWindowUsed : null,
      },
      new: {
        total: newSummary.total,
        contacted: newSummary.contacted,
        uncontacted: newSummary.uncontacted,
      },
      recent: {
        total: recentSummary.totalCount ?? recentSummary.total ?? recentBreakdown.total,
        contacted: recentSummary.contacted ?? 0,
        uncontacted:
          recentSummary.uncontacted ??
          (recentSummary.totalCount != null
            ? recentSummary.totalCount - (recentSummary.contacted || 0)
            : recentBreakdown.total - (recentSummary.contacted || 0)),
        in48: recentBreakdown.in48,
        in72: recentBreakdown.in72,
      },
      attention: {
        total: attentionCounts.total,
        contacted: attentionCounts.contacted,
        uncontacted: attentionCounts.uncontacted,
        needs: attentionCounts.needs,
        refer: attentionSummary?.refer ?? null,
        missingDocs: attentionSummary?.missingDocs ?? null,
      },
    }),
    [
      top10Counts,
      topFallbackNotice,
      topWindowUsed,
      newSummary,
      recentSummary,
      recentBreakdown,
      attentionCounts,
      attentionSummary,
    ]
  );

  const new24ByCounty = useMemo(() => {
    const m = new Map();
    ALL_COUNTIES.forEach((c) => m.set(c, 0));
    new24List.forEach((r) => {
      const key = normCountyKey(r.county);
      const v = Number(r.bond_amount ?? 0) || 0;
      m.set(key, (m.get(key) || 0) + v);
    });
    return m;
  }, [new24List]);

  const recentByCounty = useMemo(() => {
    const m = new Map();
    ALL_COUNTIES.forEach((c) => m.set(c, 0));
    recentList.forEach((r) => {
      const key = normCountyKey(r.county);
      const v = Number(r.bond_amount ?? 0) || 0;
      m.set(key, (m.get(key) || 0) + v);
    });
    return m;
  }, [recentList]);

  // Trends helpers
  const trendLabels = Array.isArray(countyTrends?.labels) ? countyTrends.labels : [];
  const seriesByCounty = useMemo(() => {
    const acc = {};
    if (Array.isArray(countyTrends?.bondSeriesArr)) {
      countyTrends.bondSeriesArr.forEach(({ name, data }) => {
        const key = normCountyKey(name);
        acc[key] = Array.isArray(data) ? data : [];
      });
    } else if (countyTrends?.bondSeries) {
      Object.entries(countyTrends.bondSeries).forEach(([name, data]) => {
        const key = normCountyKey(name);
        acc[key] = Array.isArray(data) ? data : [];
      });
    }
    ALL_COUNTIES.forEach((c) => {
      if (!acc[c]) acc[c] = Array(trendLabels.length).fill(0);
    });
    return acc;
  }, [countyTrends, trendLabels.length]);

  // Map window → index into trends labels (end-anchored)
  const windowToIndexFromEnd = { '24h': 1, '48h': 2, '72h': 3 };
  const trendIndex =
    trendLabels.length >= windowToIndexFromEnd[valueWindow]
      ? trendLabels.length - windowToIndexFromEnd[valueWindow]
      : null;

  const bondValueForWindow = useCallback(
    (county) => {
      const key = normCountyKey(county);

      if (valueWindow === '24h') {
        const pc = perCountyMap.get(key);
        if (pc && Number.isFinite(Number(pc.bondToday))) {
          return Number(pc.bondToday);
        }
        const live = new24ByCounty.get(key);
        if (Number.isFinite(Number(live))) {
          return Number(live);
        }
      }

      const arr = seriesByCounty[key] || [];
      if (trendIndex == null || trendIndex < 0 || trendIndex >= arr.length) return 0;
      const v = Number(arr[trendIndex] || 0);
      return Number.isFinite(v) ? v : 0;
    },
    [valueWindow, perCountyMap, new24ByCounty, seriesByCounty, trendIndex]
  );

  const countyRows = useMemo(() => {
    return ALL_COUNTIES.map((name) => {
      const pc = perCountyMap.get(name) || {};
      const data = seriesByCounty[name] || [];
      const lastPull = lastPullMap.get(name) || '—';
      const new24 = Number(pc.counts?.today || 0);
      const new48 = Number(pc.counts?.yesterday || 0);
      const new72 = Number(pc.counts?.twoDaysAgo || 0);
      const totalVolume = new24 + new48 + new72;
      return {
        county: name,
        pretty: prettyCounty(name),
        valueTrend: data,
        new24,
        new48,
        new72,
        bondToday: Number(pc.bondToday || 0),
        bondWindowValue: bondValueForWindow(name),
        lastPull,
        flagged: isStalePull(lastPull),
        totalVolume,
      };
    });
  }, [perCountyMap, seriesByCounty, lastPullMap, bondValueForWindow]);

  const filteredCountyRows = useMemo(
    () => (countyAttentionOnly ? countyRows.filter((row) => row.flagged) : countyRows),
    [countyRows, countyAttentionOnly]
  );

  const sortedCountyRows = useMemo(() => {
    const rows = filteredCountyRows.slice();
    if (countySort === 'bond') {
      rows.sort((a, b) => b.bondWindowValue - a.bondWindowValue);
    } else if (countySort === 'volume') {
      rows.sort((a, b) => b.totalVolume - a.totalVolume);
    } else {
      rows.sort((a, b) => a.pretty.localeCompare(b.pretty));
    }
    return rows;
  }, [filteredCountyRows, countySort]);

  // KPIs (as provided by /kpis)
  const kpis = kpiData
    ? {
        new24: kpiData.newCountsBooked?.today ?? 0,
        new48: kpiData.newCountsBooked?.yesterday ?? 0,
        new72: kpiData.newCountsBooked?.twoDaysAgo ?? 0,
        contacted24: kpiData.contacted24h ?? { contacted: 0, total: 0, rate: 0 },
      }
    : { new24: 0, new48: 0, new72: 0, contacted24: { contacted: 0, total: 0, rate: 0 } };

  const loading =
    kpisLoading ||
    topLoading ||
    perCountyLoading ||
    trendsLoading ||
    new24Loading ||
    recentLoading ||
    attentionLoading;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-10 bg-white border-b">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
            <span className="text-xs text-slate-500 hidden sm:block">v0.1</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="animate-pulse grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-white rounded-2xl border shadow-sm" />
            ))}
          </div>
          <div className="animate-pulse grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-48 bg-white rounded-2xl border shadow-sm lg:col-span-2" />
            <div className="h-48 bg-white rounded-2xl border shadow-sm" />
          </div>
          <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-white rounded-2xl border shadow-sm" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const CountyTicker = ({ map, windowLabel }) => (
    <div className="mb-3 flex flex-wrap gap-2">
      {ALL_COUNTIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => navigate(`/cases?county=${encodeURIComponent(c)}&window=${windowLabel}`)}
          className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-gray-50"
          title={`Open ${prettyCounty(c)} ${windowLabel}`}
        >
          <span className="mr-2">{prettyCounty(c)}</span>
          <span className="font-semibold">{money(map.get(c) || 0)}</span>
        </button>
      ))}
    </div>
  );

  const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);

  const activeRows = snapshotRowsByTab[snapshotTab] || [];
  const activeSummary = snapshotSummaries[snapshotTab] || {};
  const activeFilter = snapshotFilters[snapshotTab] || 'all';
  const emptyMessage = SNAPSHOT_EMPTY_COPY[snapshotTab] || 'Nothing to show here.';

  const formatCount = (value) => Number(value ?? 0).toLocaleString();

  const summaryChips = (() => {
    const chips = [];
    const showing = `Showing ${formatCount(activeRows.length)} of ${formatCount(activeSummary.total)}`;
    if (snapshotTab === 'top') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      if (activeSummary.fallbackWindow) {
        chips.push(`Window fallback: ${activeSummary.fallbackWindow}`);
      }
    } else if (snapshotTab === 'new') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
    } else if (snapshotTab === 'recent') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      chips.push(`48h: ${formatCount(activeSummary.in48)}`);
      chips.push(`72h: ${formatCount(activeSummary.in72)}`);
    } else if (snapshotTab === 'attention') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      if (activeSummary.needs != null) {
        chips.push(`Needs attention: ${formatCount(activeSummary.needs)}`);
      }
      if (activeSummary.refer != null) {
        chips.push(`Refer to magistrate: ${formatCount(activeSummary.refer)}`);
      }
      if (activeSummary.missingDocs != null) {
        chips.push(`Missing docs: ${formatCount(activeSummary.missingDocs)}`);
      }
    } else {
      chips.push(showing);
    }
    return chips;
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
          <span className="text-xs text-slate-500 hidden sm:block">v0.1</span>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="New (24h)" value={kpis.new24} to="/cases?window=24h" />
          <KpiCard label="New (48h)" value={kpis.new48} to="/cases?window=48h" />
          <KpiCard label="New (72h)" value={kpis.new72} to="/cases?window=72h" />
          <KpiCard
            label="Contacted (24h)"
            value={`${kpis.contacted24.contacted}/${kpis.contacted24.total}`}
            sublabel={`${Math.round((kpis.contacted24.rate || 0) * 100)}%`}
            tone="success"
            to="/cases?window=24h&contacted=true"
          />
        </div>

        {/* Attention funnel + county bond value */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {attentionSummary ? (
            <Panel
              title="Attention funnel"
              subtitle="Snapshot of cases needing manual review"
              to="/reports"
            >
              <div className="space-y-4 text-sm text-slate-700">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Needs attention</span>
                    <span>
                      {attentionSummary.needs.toLocaleString()} ({percent(attentionSummary.needs, attentionSummary.total)}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-rose-400"
                      style={{ width: `${percent(attentionSummary.needs, attentionSummary.total)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div>
                    <div className="text-slate-500">Refer to magistrate</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.refer.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Letter suffix</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.letter.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Missing required docs</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.missingDocs.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Total cases</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.total.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel
            title={`County Bond Value (${valueWindow})`}
            subtitle="Sum of bond amounts for new bookings in the selected window (24h prefers per-county today, then live feed)"
            right={<WindowSwitcher value={valueWindow} onChange={setValueWindow} />}
          >
            <div className="grid grid-cols-2 gap-3">
              {ALL_COUNTIES.map((name) => {
                const amount = bondValueForWindow(name);
                return (
                  <div key={name} className="rounded-xl border p-3">
                    <div className="text-sm font-semibold text-slate-800">{prettyCounty(name)}</div>
                    <div className="text-slate-500 text-xs">{money(amount)}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Snapshot panel with tabs */}
        <Panel
          title="Inmate Snapshot"
          subtitle="Top value, fresh bookings, and urgent follow ups"
        >
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              {SNAPSHOT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSnapshotTab(tab.id)}
                  data-active={snapshotTab === tab.id}
                  className="rounded-full border px-3 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {SNAPSHOT_CONTACT_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSnapshotFilter(snapshotTab, filter.id)}
                  data-active={activeFilter === filter.id}
                  className="rounded-full border px-2 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                >
                  {filter.label}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {summaryChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500"
                  >
                    {chip}
                  </span>
                ))}
                {snapshotTab === 'top' ? (
                  <WindowSwitcher value={valueWindow} onChange={setValueWindow} />
                ) : null}
              </div>
            </div>

            {snapshotTab === 'top' && topFallbackNotice ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No bookings in the last 24h. Showing {topWindowUsed} window instead.
              </div>
            ) : null}

            {snapshotTab === 'attention' && attentionSummary ? (
              <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Priority counts mirror the funnel above so the team can act on the highest risk items first.
              </div>
            ) : null}

            {snapshotTab === 'new' ? <CountyTicker map={new24ByCounty} windowLabel="24h" /> : null}
            {snapshotTab === 'recent' ? <CountyTicker map={recentByCounty} windowLabel="48-72h" /> : null}

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-semibold">Person</th>
                    <th className="py-2 pr-4 text-left font-semibold">County</th>
                    <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                    <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                    <th className="py-2 pr-4 text-left font-semibold">Offense</th>
                    <th className="py-2 pr-4 text-left font-semibold">Agency / Facility</th>
                    <th className="py-2 text-left font-semibold">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeRows.map((row, index) => {
                    const lastContact = safeDateLabel(row.lastContact);
                    return (
                      <tr key={row.key || `${snapshotTab}-${index}`} className="align-top">
                        <td className="py-2 pr-4 font-medium text-slate-800 align-top">
                          {row.caseId ? (
                            <Link to={`/cases/${row.caseId}`} className="text-blue-600 hover:text-blue-700">
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          )}
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-600">
                            {row.sex ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 uppercase tracking-wide">
                                {row.sex}
                              </span>
                            ) : null}
                            {row.race ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5">
                                {row.race}
                              </span>
                            ) : null}
                            {row.windowLabel ? (
                              <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-600">
                                {row.windowLabel}
                              </span>
                            ) : null}
                            {row.category ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5">
                                {formatLabel(row.category)}
                              </span>
                            ) : null}
                            {row.needsAttention ? (
                              <span className="inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {row.attentionReasons.slice(0, 2).map((reason) => (
                              <span
                                key={reason}
                                className="inline-flex items-center rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-600"
                              >
                                {formatLabel(reason)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-slate-700 align-top">{row.county}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top">{row.booked || '—'}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top">
                          <BondDisplay amount={row.bondAmount} status={row.bondStatus} raw={row.bondRaw} />
                        </td>
                        <td className="py-2 pr-4 text-slate-700 align-top truncate max-w-[36ch]">{row.offense || '—'}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top truncate max-w-[28ch]">{row.agency || '—'}</td>
                        <td className="py-2 align-top">
                          {row.contacted ? (
                            <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">
                              Contacted
                            </span>
                          ) : row.caseId ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/messages?compose=initial&case=${row.caseId}`)}
                              className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                            >
                              Send outreach
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">No outreach available</span>
                          )}
                          {lastContact ? (
                            <div className="mt-1 text-[10px] text-slate-400">Last contact {lastContact}</div>
                          ) : null}
                          {row.caseId ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => navigate(`/cases/${row.caseId}`)}
                                className="text-xs inline-flex items-center rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                              >
                                Open case
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/cases/${row.caseId}?tab=checklist`)}
                                className="text-xs inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-blue-300 hover:text-blue-700"
                              >
                                Checklist
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {activeRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        {emptyMessage}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>

        {/* County trends */}
        <Panel title="County Trends (last 7 days)" subtitle="New vs aging volume and bond value">
          {sortedCountyRows.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedCountyRows.map((c) => (
                <div key={c.county} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800">{c.pretty}</div>
                    <div className="text-xs text-slate-500">Today: {money(c.bondToday)}</div>
                  </div>
                  <div className="mt-3">
                    <MiniStackedBar new24={c.new24} new48={c.new48} new72={c.new72} />
                  </div>
                  <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3">
                    <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" /> 24h
                    <span className="inline-block w-3 h-3 bg-amber-400 rounded-sm" /> 48h
                    <span className="inline-block w-3 h-3 bg-red-400 rounded-sm" /> 72h
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Bond value (7d)</div>
                  <Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} />
                  {c.flagged ? (
                    <div className="mt-3 inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      Data pull is stale
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              All counties are up to date for this filter.
            </div>
          )}
        </Panel>

        {/* Counties Overview */}
        <Panel
          title="Counties Overview"
          subtitle="Pull status and daily value by county"
          to="/cases"
          right={
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
                {COUNTY_SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCountySort(opt.id)}
                    data-active={countySort === opt.id}
                    className="rounded-full px-2 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={countyAttentionOnly}
                  onChange={(event) => setCountyAttentionOnly(event.target.checked)}
                />
                Attention only
              </label>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b">
                  <th className="py-2 pr-3 text-left font-semibold">County</th>
                  <th className="py-2 pr-3 text-right font-semibold">24h</th>
                  <th className="py-2 pr-3 text-right font-semibold">48h</th>
                  <th className="py-2 pr-3 text-right font-semibold">72h</th>
                  <th className="py-2 pr-3 text-right font-semibold">Bond ({valueWindow})</th>
                  <th className="py-2 pr-3 text-left font-semibold">Trend (7d)</th>
                  <th className="py-2 pr-3 text-left font-semibold">Last pull</th>
                  <th className="py-2 pr-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {sortedCountyRows.length ? (
                  sortedCountyRows.map((c) => (
                    <tr key={c.county} className="hover:bg-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <span>{c.pretty}</span>
                          {c.flagged ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                              Needs attention
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">{c.new24.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.new48.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.new72.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{money(c.bondWindowValue)}</td>
                      <td className="py-2 pr-3"><Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} /></td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {c.lastPull === '—' ? '—' : new Date(c.lastPull).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => navigate(`/cases?county=${encodeURIComponent(c.county)}&window=${valueWindow}`)}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                          >
                            View cases
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/reports?county=${encodeURIComponent(c.county)}`)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-blue-300 hover:text-blue-700"
                          >
                            Trend
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      All counties are clear for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </div>
  );
}
