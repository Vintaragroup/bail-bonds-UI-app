import { Link, useNavigate } from 'react-router-dom'
import { useKpis, useTopByValue, usePerCounty, useCountyTrends, useNew24h, useRecentWindow } from '../hooks/dashboard'

function MiniStackedBar({ new24, new48, new72, maxTotal }) {
  const total = Math.max(new24 + new48 + new72, 0.0001);
  const scale = total / Math.max(maxTotal, 1);
  const w = Math.max(4 + Math.round(scale * 100), 4); // percent width
  const p24 = (new24 / total) * 100;
  const p48 = (new48 / total) * 100;
  const p72 = (new72 / total) * 100;
  return (
    <div className="w-full">
      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-green-400" style={{ width: `${p24}%` }} />
        <div className="h-full bg-amber-400" style={{ width: `${p48}%` }} />
        <div className="h-full bg-red-400" style={{ width: `${p72}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>24h: {new24}</span>
        <span>48h: {new48}</span>
        <span>72h: {new72}</span>
      </div>
    </div>
  );
}

function Sparkline({ values = [] }) {
  const width = 160, height = 36, pad = 2;
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="block">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500" />
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

function Panel({ title, subtitle, children, className = '', to }) {
  return (
    <section className={`bg-white rounded-2xl border shadow-sm p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {to ? (
          <Link to={to} className="text-sm text-blue-600 hover:text-blue-700">View all</Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CountyCard({ county, lastPull, new24, new48, new72, contacted24, bondToday }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-800">{county}</div>
        <div className="text-xs text-slate-500">Last pull: {lastPull}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div><div className="font-semibold text-slate-800">{new24}</div><div className="text-slate-500">New 24h</div></div>
        <div><div className="font-semibold text-slate-800">{new48}</div><div className="text-slate-500">New 48h</div></div>
        <div><div className="font-semibold text-slate-800">{new72}</div><div className="text-slate-500">New 72h</div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div><div className="font-semibold text-slate-800">{contacted24}</div><div className="text-slate-500">Contacted 24h</div></div>
        <div><div className="font-semibold text-slate-800">${bondToday.toLocaleString()}</div><div className="text-slate-500">Bond value (today)</div></div>
      </div>
      <div className="mt-3">
        <Link to={`/cases?county=${encodeURIComponent(county)}&window=24h`} className="text-sm text-blue-600 hover:text-blue-700">Open county →</Link>
      </div>
    </div>
  );
}

export default function DashboardScreen() {
  const navigate = useNavigate();

  const { data: kpiData, isLoading: kpisLoading } = useKpis();
  const { data: top10, isLoading: topLoading } = useTopByValue();
  const { data: perCounty, isLoading: perCountyLoading } = usePerCounty();
  const { data: countyTrends, isLoading: trendsLoading } = useCountyTrends();
  const { data: new24h, isLoading: new24Loading } = useNew24h();
  const { data: recent48to72, isLoading: recentLoading } = useRecentWindow();

  // Normalizers
  const perCountyItems = perCounty?.items ?? [];
  const top10List = Array.isArray(top10) ? top10 : [];
  const new24List = Array.isArray(new24h?.items) ? new24h.items : Array.isArray(new24h) ? new24h : [];
  const recentList = Array.isArray(recent48to72?.items) ? recent48to72.items : Array.isArray(recent48to72) ? recent48to72 : [];
  const trendsList = Array.isArray(countyTrends?.items) ? countyTrends.items : Array.isArray(countyTrends) ? countyTrends : [];

  // KPIs - match server output
  const kpis = kpiData ? {
    new24: kpiData.newCountsBooked?.today ?? 0,
    new48: kpiData.newCountsBooked?.yesterday ?? 0,
    new72: kpiData.newCountsBooked?.twoDaysAgo ?? 0,
    contacted24: kpiData.contacted24h ?? { contacted: 0, total: 0, rate: 0 },
  } : { new24: 0, new48: 0, new72: 0, contacted24: { contacted: 0, total: 0, rate: 0 } };

  const loading = kpisLoading || topLoading || perCountyLoading || trendsLoading || new24Loading || recentLoading;

  const maxTotal = trendsList.length
    ? Math.max(...trendsList.map(c => (c.new24 || 0) + (c.new48 || 0) + (c.new72 || 0)))
    : 1;

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
            sublabel={`${Math.round(kpis.contacted24.rate * 100)}%`}
            tone="success"
            to="/cases?window=24h&contacted=true"
          />
        </div>

        {/* Value & County panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top by value */}
          <Panel className="lg:col-span-2" title="Top 10 by Value (24h)" subtitle="Highest bond amount or assessment" to="/cases?window=24h&sort=value:desc">
            {top10List.length ? (
              <ul className="divide-y text-sm">
                {top10List.map((x) => (
                  <li key={x.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-slate-800">{x.name}</div>
                      <div className="text-slate-500 text-xs">
                        {x.county} • Booked {x.booking_date || x.bookedAt || ''}
                      </div>
                    </div>
                    <div className="font-semibold">
                      ${Number(x.value || x.bond_amount || 0).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500">
                No bookings in the last 24 hours. (We can fall back to yesterday if you want.)
              </div>
            )}
          </Panel>

          {/* County bond value today */}
          <Panel title="County Bond Value (today)" subtitle="Sum of bond amounts for new bookings today" to="/cases?date=today">
            <div className="grid grid-cols-2 gap-3">
              {perCountyItems.map((c) => (
                <div key={c.county} className="rounded-xl border p-3">
                  <div className="text-sm font-semibold text-slate-800">{c.county}</div>
                  <div className="text-slate-500 text-xs">${Number(c.bondToday || 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="County Trends (last 7 days)" subtitle="New vs aging volume and bond value">
          {trendsList.length === 0 ? (
            <div className="text-sm text-slate-500">No trend data yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {trendsList.map((c) => (
                <div key={c.county} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800">{c.county}</div>
                    <div className="text-xs text-slate-500">
                      Today: ${Number(c.bondToday || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-3">
                    <MiniStackedBar
                      new24={c.new24 || 0}
                      new48={c.new48 || 0}
                      new72={c.new72 || 0}
                      maxTotal={maxTotal}
                    />
                  </div>
                  <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3">
                    <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" /> 24h
                    <span className="inline-block w-3 h-3 bg-amber-400 rounded-sm" /> 48h
                    <span className="inline-block w-3 h-3 bg-red-400 rounded-sm" /> 72h
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Bond value (7d)</div>
                  <Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* New (24h) */}
        <Panel title="New Inmates (24h)" subtitle="Most recent bookings with contact status" to="/cases?window=24h">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr className="border-b">
                  <th className="py-2 pr-4 text-left font-semibold">Person</th>
                  <th className="py-2 pr-4 text-left font-semibold">County</th>
                  <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                  <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                  <th className="py-2 text-left font-semibold">Contacted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {new24List.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-4 font-medium text-slate-800">
                      <Link to={`/cases/${row.id}`} className="text-blue-600 hover:text-blue-700">{row.person}</Link>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{row.county}</td>
                    <td className="py-2 pr-4 text-slate-700">{row.booking_date || row.bookedAt || ''}</td>
                    <td className="py-2 pr-4 text-slate-700">${Number(row.bond || row.bond_amount || 0).toLocaleString()}</td>
                    <td className="py-2">
                      {row.contacted ? (
                        <span className="inline-flex items-center rounded-md bg-green-50 text-green-700 text-xs px-2 py-1">Yes</span>
                      ) : (
                        <button
                          onClick={() => navigate(`/messages?compose=initial&case=${row.id}`)}
                          className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                        >Send outreach</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Recent (48–72h) */}
        <Panel title="Recent Inmates (48–72h)" subtitle="Focus on uncontacted & high value" to="/cases?window=48-72h">
          {(() => {
            const list = Array.isArray(recentList) ? recentList : [];
            const withValue = list.map(r => ({
              ...r,
              _bondValue: Number(r.bond ?? r.bond_amount ?? 0) || 0,
              _bookedDate: r.booking_date || r.bookedAt || null,
            }));

            const now = new Date();
            const hoursFromNow = (dStr) => {
              if (!dStr) return Infinity;
              const d = /^\d{4}-\d{2}-\d{2}$/.test(dStr) ? new Date(dStr + "T00:00:00Z") : new Date(dStr);
              return (now - d) / (1000 * 60 * 60);
            };

            const in48 = withValue.filter(r => {
              const h = hoursFromNow(r._bookedDate);
              return h >= 24 && h < 48;
            }).length;

            const in72 = withValue.filter(r => {
              const h = hoursFromNow(r._bookedDate);
              return h >= 48 && h <= 72;
            }).length;

            const total = withValue.length;

            const top10 = withValue
              .slice()
              .sort((a, b) => b._bondValue - a._bondValue)
              .slice(0, 10);

            return (
              <>
                <div className="mb-3 text-xs text-slate-600">
                  <span className="mr-3">Total: <span className="font-semibold">{total}</span></span>
                  <span className="mr-3">48h: <span className="font-semibold">{in48}</span></span>
                  <span>72h: <span className="font-semibold">{in72}</span></span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500">
                      <tr className="border-b">
                        <th className="py-2 pr-4 text-left font-semibold">Person</th>
                        <th className="py-2 pr-4 text-left font-semibold">County</th>
                        <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                        <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                        <th className="py-2 text-left font-semibold">Contacted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {top10.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2 pr-4 font-medium text-slate-800">
                            <Link to={`/cases/${row.id}`} className="text-blue-600 hover:text-blue-700">
                              {row.person}
                            </Link>
                          </td>
                          <td className="py-2 pr-4 text-slate-700">{row.county}</td>
                          <td className="py-2 pr-4 text-slate-700">{row._bookedDate || ''}</td>
                          <td className="py-2 pr-4 text-slate-700">
                            ${row._bondValue.toLocaleString()}
                          </td>
                          <td className="py-2">
                            {row.contacted ? (
                              <span className="inline-flex items-center rounded-md bg-green-50 text-green-700 text-xs px-2 py-1">Yes</span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-amber-50 text-amber-700 text-xs px-2 py-1">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {top10.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No results in the 48–72h window.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </Panel>

        {/* County overview */}
        <Panel title="Counties Overview" subtitle="Pull status and daily value by county" to="/cases">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {perCountyItems.map((c) => (
              <CountyCard
                key={c.county}
                county={c.county}
                lastPull={(kpiData?.perCountyLastPull || []).find(x => x.county === c.county)?.lastPull || '—'}
                new24={c.counts?.today || 0}
                new48={c.counts?.yesterday || 0}
                new72={c.counts?.twoDaysAgo || 0}
                contacted24={0}
                bondToday={Number(c.bondToday || 0)}
              />
            ))}
          </div>
        </Panel>
      </main>
    </div>
  );
}