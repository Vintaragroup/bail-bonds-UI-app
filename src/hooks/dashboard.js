import { useQuery } from '@tanstack/react-query';
import {
  getDashboardKpis,
  getTopByValue,
  getPerCountyOverview,
  getCountyTrends,
  getNewInmates24h,
  getRecent48to72,
} from '../lib/api';

// KPIs (booking-day based: today, yesterday, twoDaysAgo, last7d, last30d)
export const useKpis = () =>
  useQuery({
    queryKey: ['kpis'],
    queryFn: getDashboardKpis,
    staleTime: 60_000,
  });

// Top by value — supports windows: '24h' | '48h' | '72h' | '7d' | '30d'
// NOTE: getTopByValue should accept an options object { window, limit }
export const useTopByValue = (windowKey = '24h', limit = 10) =>
  useQuery({
    queryKey: ['topByValue', windowKey, limit],
    queryFn: () => getTopByValue({ window: windowKey, limit }),
    staleTime: 60_000,
    keepPreviousData: true,
  });

// County overview snapshot — placeholder (server `/per-county` to be added)
export const usePerCounty = (dayKey = 'today') =>
  useQuery({
    queryKey: ['perCounty', dayKey],
    queryFn: () => getPerCountyOverview({ day: dayKey }),
    staleTime: 60_000,
    enabled: typeof getPerCountyOverview === 'function',
  });

// Trends over last N days (booking_date based)
// NOTE: getCountyTrends should accept an options object { days }
export const useCountyTrends = (days = 7) =>
  useQuery({
    queryKey: ['countyTrends', days],
    queryFn: () => getCountyTrends({ days }),
    staleTime: 60_000,
    keepPreviousData: true,
  });

// New today (booking_date === today). Backward-compatible name kept.
// NOTE: getNewInmates24h should accept an options object { county }
export const useNew24h = (county) =>
  useQuery({
    queryKey: ['newToday', county || 'all'],
    queryFn: () => getNewInmates24h({ county }),
    staleTime: 60_000,
  });

// Recent window (yesterday + twoDaysAgo). Backward-compatible name kept.
export const useRecentWindow = () =>
  useQuery({
    queryKey: ['recent48to72'],
    queryFn: () => getRecent48to72(),
    staleTime: 60_000,
  });

// Aliases with clearer names (optional re-exports)
export const useNewToday = useNew24h;
export const useRecent = useRecentWindow;