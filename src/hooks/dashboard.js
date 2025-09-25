// src/hooks/dashboard.js
import { useQuery } from '@tanstack/react-query';

// Base URL – works with your root .env: VITE_API_URL=http://localhost:8080/api
export const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:8080/api'
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
  return useQuery({
    queryKey: ['kpis'],
    queryFn: () => getJSON('/dashboard/kpis'),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
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
  return useQuery({
    queryKey: ['topByValue', window, limit],
    queryFn: async () => {
      const data = await getJSON(`/dashboard/top?window=${encodeURIComponent(window)}&limit=${encodeURIComponent(limit)}`);
      // Pass through enrichment fields if present
      return data;
    },
    staleTime: 60_000,
    placeholderData: (previous) => previous,
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
  return useQuery({
    queryKey: ['newToday', scope],
    queryFn: async () => {
      const data = await getJSON(`/dashboard/new${qs}`);
      return data;
    },
    staleTime: 30_000,
    placeholderData: (previous) => previous,
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
  return useQuery({
    queryKey: ['recent48to72', limit],
    queryFn: async () => {
      const data = await getJSON(`/dashboard/recent?limit=${encodeURIComponent(limit)}`);
      const items = Array.isArray(data?.items) ? data.items : [];

      if (data.summary) {
        return { items: items.slice(0, limit), summary: data.summary };
      }

      // Derive quick client summary (counts & totals) to show above the table.
      const totals = items.reduce(
        (acc, it) => {
          const amount = Number(it.bond_amount ?? 0) || 0;
          acc.totalCount += 1;
          acc.totalBond += amount;

          // Partition by booking_date relative age if needed on UI
          // (You can keep this simple: everything from /recent is 48–72h.)
          acc.count48 += 1; // keep all here; tweak if you later split by exact date
          acc.bond48 += amount;
          return acc;
        },
        { totalCount: 0, totalBond: 0, count48: 0, bond48: 0 }
      );

      return {
        items: items.slice(0, limit),
        summary: {
          total: totals.totalCount,
          totalBond: totals.totalBond,
          // Keeping 72h bucket 0 for now (endpoint is 48–72 combined)
          byBucket: [
            { label: '48h', count: totals.count48, bond: totals.bond48 },
            { label: '72h', count: 0, bond: 0 },
          ],
        },
      };
    },
    staleTime: 30_000,
    placeholderData: (previous) => previous,
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
  return useQuery({
    queryKey: ['perCounty', window],
    queryFn: async () => {
      const data = await getJSON(`/dashboard/per-county?window=${encodeURIComponent(window)}`);
      return data;
    },
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    ...options,
  });
}
