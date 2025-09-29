// src/hooks/dashboard.js
import { useQuery } from '@tanstack/react-query';
// NOTE: For aggregated polling across multiple endpoints prefer useSerializedPolling in polling.js
import { useOptionalDashboardAggregated } from '../components/DashboardAggregatedProvider.jsx';

// Base URL resolution:
// 1) Runtime window.__ENV__.VITE_API_URL if present (injected by /public/env.js)
// 2) In dev only, allow build-time import.meta.env.VITE_API_URL
// 3) Otherwise default to '/api' (same-origin reverse proxy)
const RUNTIME_ENV = (typeof window !== 'undefined' && window.__ENV__) || {};
export const API_BASE = (
  RUNTIME_ENV.VITE_API_URL
  || (typeof import.meta !== 'undefined' && import.meta.env?.DEV ? import.meta.env.VITE_API_URL : undefined)
  || '/api'
).replace(/\/$/, '');

// In-flight request de-duplication to prevent bursts of identical GETs
const inflight = new Map(); // key -> Promise

function normalizeKey(urlStr) {
  try {
    const u = new URL(urlStr);
    // Drop cache-buster and any local-only churn keys
    const qp = new URLSearchParams(u.search);
    ['_cb', '_', 'cb', 'cacheBust', 'cachebuster'].forEach((k) => qp.delete(k));
    // Re-add kept params in stable order
    const stable = new URLSearchParams();
    Array.from(qp.keys()).sort().forEach((k) => stable.set(k, qp.get(k)));
    const qs = stable.toString();
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return urlStr;
  }
}

export async function getJSON(path) {
  const base = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  // Add a cache-busting param to avoid conditional GET/304 and keep request simple
  const url = `${base}${base.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
  const key = normalizeKey(url);

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const p = (async () => {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed ${res.status}: ${text}`);
    }
    return res.json();
  })();

  inflight.set(key, p);
  // Clear after it settles to allow a small coalesce window
  p.finally(() => {
    // Leave result available for a short moment in case of immediate re-renders
    setTimeout(() => inflight.delete(key), 1000);
  });
  return p;
}

export async function sendJSON(path, { method = 'POST', body, headers } = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function sendFormData(path, { method = 'POST', formData, headers } = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    body: formData,
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers,
    },
    cache: 'no-store',
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/** -----------------------------
 *  KPIs (+ per-county bond window)
 *  -----------------------------
 *  Backend: GET /kpis?bondWindow=(24h|48h|72h|rolling72|7d|30d)
 *  Returns: { newCountsBooked, perCountyBondToday, bondTodayTotal, perCountyLastPull }
 */
export function useKpis(options = {}) {
  const agg = useOptionalDashboardAggregated();
  const enabled = !agg; // disable individual query if aggregated polling supplies data
  return useQuery({
    queryKey: ['kpis'],
    queryFn: () => getJSON('/dashboard/kpis'),
    enabled,
    initialData: agg?.data?.kpis,
    staleTime: 60_000,
    placeholderData: (previous) => previous ?? agg?.data?.kpis,
    ...options,
  });
}

/** -----------------------------
 *  Top by Value (booking window)
 *  -----------------------------
 *  Backend: GET /top?window=(24h|48h|72h|rolling72|7d|30d)&limit=10
 *  Returns: Array<{ id, name, county, booking_date, bond_amount, value }>
 */
export function useTopByValue(window = '24h', limit = 10, options = {}) {
  const agg = useOptionalDashboardAggregated();
  // aggregated key uses fixed limit=10 & window=24h currently; only map if matching
  const aggKeyMatch = window === '24h' && limit === 10;
  const initial = aggKeyMatch ? agg?.data?.top24 : undefined;
  const enabled = !(agg && aggKeyMatch);
  return useQuery({
    queryKey: ['topByValue', window, limit],
    queryFn: async () => getJSON(`/dashboard/top?window=${encodeURIComponent(window)}&limit=${encodeURIComponent(limit)}`),
    enabled,
    initialData: initial,
    staleTime: 60_000,
    placeholderData: (previous) => previous ?? initial,
    ...options,
  });
}

/** -----------------------------
 *  New Today (by booking_date=“today”)
 *  -----------------------------
 *  Backend: GET /new[?county=harris]
 *  Returns: { items: [{ id, person, county, booking_date, bond, contacted:false }] }
 */
export function useNewToday(scope = 'all', options = {}) {
  // scope can be 'all' or a county slug
  const qs = scope && scope !== 'all' ? `?county=${encodeURIComponent(scope)}` : '';
  const agg = useOptionalDashboardAggregated();
  const aggKeyMatch = scope === 'all';
  const initial = aggKeyMatch ? agg?.data?.newToday : undefined;
  const enabled = !(agg && aggKeyMatch);
  return useQuery({
    queryKey: ['newToday', scope],
    queryFn: async () => getJSON(`/dashboard/new${qs}`),
    enabled,
    initialData: initial,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? initial,
    ...options,
  });
}

/** -----------------------------
 *  Recent 48–72h (yesterday + twoDaysAgo)
 *  -----------------------------
 *  Backend: GET /recent
 *  Returns: { items: [{ id, person, county, booking_date, bond, contacted:false }] }
 *  We also derive a tiny client-side summary for convenience.
 */
export function useRecent48to72(limit = 10, options = {}) {
  const agg = useOptionalDashboardAggregated();
  const aggKeyMatch = limit === 10;
  const initial = aggKeyMatch ? agg?.data?.recent : undefined;
  const enabled = !(agg && aggKeyMatch);
  return useQuery({
    queryKey: ['recent48to72', limit],
    queryFn: async () => getJSON(`/dashboard/recent?limit=${encodeURIComponent(limit)}`),
    enabled,
    initialData: initial,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? initial,
    ...options,
  });
}

/** -----------------------------
 *  County Trends (last N days)
 *  -----------------------------
 *  Backend: GET /trends?days=7
 *  Returns: { days, dates:[YYYY-MM-DD...], rows:[{ county, date, count, bondSum }] }
 *  We reshape into { labels, seriesByCounty } for charts.
 */
export function useCountyTrends(days = 7, options = {}) {
  return useQuery({
    queryKey: ['countyTrends', days],
    queryFn: async () => {
      const data = await getJSON(`/dashboard/trends?days=${encodeURIComponent(days)}`);
      const labels = Array.isArray(data?.dates) ? data.dates : [];
      const rows = Array.isArray(data?.rows) ? data.rows : [];

      const key = (county, date) => `${county}__${date}`;
      const byKey = new Map();
      rows.forEach((row) => {
        if (!row?.county || !row?.date) return;
        byKey.set(key(row.county, row.date), row);
      });

      const countySet = new Set(rows.map((row) => row?.county).filter(Boolean));
      const counties = Array.from(countySet).sort();

      const countSeries = {};
      const bondSeries = {};
      counties.forEach((county) => {
        countSeries[county] = labels.map((date) => {
          const entry = byKey.get(key(county, date));
          return Number(entry?.count ?? 0);
        });
        bondSeries[county] = labels.map((date) => {
          const entry = byKey.get(key(county, date));
          return Number(entry?.bondSum ?? entry?.bond_sum ?? 0);
        });
      });

      const bondSeriesArr = counties.map((county) => ({ name: county, data: bondSeries[county] || [] }));

      return {
        labels,
        counties,
        countSeries,
        bondSeries,
        bondSeriesArr,
      };
    },
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    ...options,
  });
}

/** -----------------------------
 *  Per-County Snapshot
 *  -----------------------------
 *  Backend: GET /per-county?window=(24h|48h|72h|rolling72|7d|30d)
 *  Returns: { items:[{ county, counts:{today,yesterday,twoDaysAgo,last7d,last30d}, bondToday }] }
 */
export function usePerCounty(window = 'rolling72', options = {}) {
  const agg = useOptionalDashboardAggregated();
  const aggKeyMatch = window === '24h'; // provider only fetches 24h snapshot currently
  const initial = aggKeyMatch ? agg?.data?.perCounty24 : undefined;
  const enabled = !(agg && aggKeyMatch);
  return useQuery({
    queryKey: ['perCounty', window],
    queryFn: async () => getJSON(`/dashboard/per-county?window=${encodeURIComponent(window)}`),
    enabled,
    initialData: initial,
    staleTime: 60_000,
    placeholderData: (previous) => previous ?? initial,
    ...options,
  });
}
