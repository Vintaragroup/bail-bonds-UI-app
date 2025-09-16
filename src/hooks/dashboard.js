// src/hooks/dashboard.js
import { useQuery } from '@tanstack/react-query';

// Base URL – works with your root .env: VITE_API_URL=http://localhost:8080/api
const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:8080/api'
  ).replace(/\/$/, '');

async function getJSON(path) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }
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
    queryFn: () => getJSON('/health/kpis'),
    staleTime: 60_000,
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
    queryFn: () =>
      getJSON(`/dashboard/top?window=${encodeURIComponent(window)}&limit=${encodeURIComponent(limit)}`),
    staleTime: 60_000,
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
    queryFn: () => getJSON(`/dashboard/new${qs}`),
    staleTime: 30_000,
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
      const data = await getJSON(`/health/trends?days=${encodeURIComponent(days)}`);
      const series = Array.isArray(data?.series) ? data.series : [];
      const labels = series.map((s) => s.date);
      // Health/trends is overall (not per-county). Expose a single 'all' series for charts.
      const countSeries = { all: series.map((s) => s.count || 0) };
      const bondSeries = { all: series.map((s) => s.bond_sum ?? s.bondSum ?? 0) };
      return {
        labels,
        counties: ['all'],
        countSeries,
        bondSeries,
      };
    },
    staleTime: 60_000,
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
    queryFn: () => getJSON(`/dashboard/per-county?window=${encodeURIComponent(window)}`),
    staleTime: 60_000,
    ...options,
  });
}