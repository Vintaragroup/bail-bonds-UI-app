// Lightweight API client for the dashboard (uses browser fetch)
// Base URL can be provided at runtime via window.__ENV__.VITE_API_URL, or at build time via import.meta.env.VITE_API_URL.
// Default to same-origin proxy path '/api' to work with Nginx/Vite proxy.

const RUNTIME_ENV = (typeof window !== 'undefined' && window.__ENV__) || {};
// Resolution order:
// 1) Runtime env from window.__ENV__.VITE_API_URL (injected by public/env.js)
// 2) If dev build, allow build-time import.meta.env.VITE_API_URL
// 3) Otherwise default to same-origin '/api' to work with reverse proxy
const RAW_API_BASE =
  (RUNTIME_ENV && RUNTIME_ENV.VITE_API_URL)
  || (import.meta?.env?.DEV ? import.meta.env.VITE_API_URL : undefined)
  || '/api';
const API_BASE = String(RAW_API_BASE).replace(/\/$/, ''); // normalize: no trailing slash

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
