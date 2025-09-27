// Lightweight API client for the dashboard (uses browser fetch)
// Base URL comes from Vite env: VITE_API_URL (e.g., http://localhost:8080/api)

const RAW_API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : 'http://localhost:8080/api';
const API_BASE = RAW_API_BASE.replace(/\/$/, ''); // normalize: no trailing slash

async function httpGet(path) {
  const fullPath = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${API_BASE}${fullPath}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// ---- KPIs (booking-day based) ----
// Returns shape from /api/dashboard/kpis:
// { newCountsBooked: { today, yesterday, twoDaysAgo, last7d, last30d }, perCountyBondToday, perCountyLastPull }
export async function getDashboardKpis() {
  return httpGet('/dashboard/kpis');
}

// ---- Top by value for a booking-day window ----
// window: '24h' | '48h' | '72h' | '7d' | '30d'
export async function getTopByValue({ window = '24h', limit = 10 } = {}) {
  const params = new URLSearchParams({ window, limit: String(limit) });
  return httpGet(`/dashboard/top?${params.toString()}`);
}

// ---- Per-county overview ----
// Server: GET /api/dashboard/per-county  -> { items: [{ county, counts: { today,yesterday,twoDaysAgo,last7d,last30d }, bondToday }] }
export async function getPerCountyOverview() {
  return httpGet('/dashboard/per-county');
}

// ---- County trends (booking_date based) ----
// Returns { days, dates: [YYYY-MM-DD...], rows: [{ county, date, count, bondSum }] }
export async function getCountyTrends({ days = 7 } = {}) {
  const params = new URLSearchParams({ days: String(days) });
  return httpGet(`/dashboard/trends?${params.toString()}`);
}

// ---- New today (booking_date === today) ----
export async function getNewInmates24h({ county } = {}) {
  const qs = county ? `?county=${encodeURIComponent(county)}` : '';
  return httpGet(`/dashboard/new${qs}`);
}

// ---- Recent (yesterday + twoDaysAgo) ----
export async function getRecent48to72() {
  return httpGet('/dashboard/recent');
}
