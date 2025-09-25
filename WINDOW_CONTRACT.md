# Window Contract

Authoritative definitions for all dashboard windows. Unless stated otherwise, all windows are strictly based on booking time (booking_dt), computed in America/Chicago.

## Timezone

- Dashboard timezone: America/Chicago
- All date-based derivations use this timezone for day boundaries.

## Windows (booking_dt-based)

- 24h ("today"): booking_dt ∈ [now − 24h, now)
- 48h: booking_dt ∈ [now − 48h, now − 24h)
- 72h: booking_dt ∈ [now − 72h, now − 48h)
- 7d:  booking_dt ∈ [now − 7d, now)
- 30d: booking_dt ∈ [now − 30d, now)

These windows are non-overlapping: 24h, 48h, and 72h are disjoint and contiguous.

## Exclusions

- Always exclude Harris County rows where category == "Civil" from dashboard aggregations.

## Fields and normalizations

- booking_dt (Date): derived coalescing (booked_at | booking_date_iso | booking_date in %Y-%m-%d).
- booking_date (string, %Y-%m-%d): normalized date string used for coarse prefilters.
- bond_amount (Number): numeric normalization of bond/bond_label, preserving non-numeric labels as metadata.
- county: lowercased/trimmed.

## Endpoints and their window usage

- GET /api/dashboard/kpis
  - Counts: 24h, 48h, 72h, 7d, 30d using booking_dt.
  - contacted24h: computed against 24h set.
  - perCountyBond: bond sums per county using preferred window list [24h, 48h, 72h, 7d] (first non-zero).

- GET /api/dashboard/per-county?window=(24h|48h|72h|7d|30d)
  - Returns per-county counts for: 24h, 24–48h (yesterday), 48–72h (twoDaysAgo), 7d, 30d.
  - bondToday: sum of bond_amount for 24h.
  - bondValue: sum of bond_amount for the requested window (windowUsed in payload).

- GET /api/dashboard/new
  - List of recent bookings by booking_dt in 24h window.
  - Sorted by booking_dt desc.

- GET /api/dashboard/recent?limit=N
  - List of bookings in 48–72h window (booking_dt ∈ [now−72h, now−48h)).
  - Sorted by booking_dt desc.

- GET /api/dashboard/top?window=(24h|48h|72h|7d|30d)
  - Top entries by bond value within the requested window.
  - May include window_used in payload when fallback logic applies.

- GET /api/cases?window=(24h|48h|72h)
  - Uses $expr to compare derived booking_dt to the requested rolling window.
  - For non-rolling windows (e.g., 48–72h deep links), use startDate/endDate on booking_date (inclusive) as an approximation.

## Validation

- 24h/48h/72h are non-overlapping and sum to 72h set.
- Lists (/new and /recent) align with the corresponding counts in KPIs and per-county.
- Harris Civil rows are excluded from aggregates.
