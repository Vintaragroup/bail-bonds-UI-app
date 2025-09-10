import { Router } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';   // optional: contacted if you link caseId
import Job from '../models/Job.js';           // optional: last-pull if you log scrape jobs

const r = Router();

const COUNTY_COLLECTIONS = [
  'simple_brazoria',
  'simple_fortbend',
  'simple_galveston',
  'simple_harris',
  'simple_jefferson',
];

// Build a $unionWith chain over all simple_* collections
function unionAll(match = {}, project = null) {
  const rest = COUNTY_COLLECTIONS.slice(1).map((coll) => ({
    $unionWith: { coll, pipeline: [ { $match: match } ].concat(project ? [{ $project: project }] : []) }
  }));
  const first = [{ $match: match }];
  if (project) first.push({ $project: project });
  return first.concat(rest);
}

// Common projection (normalize names across collections)
const P = {
  _id: 1,
  county: 1,
  full_name: 1,
  booking_date: 1,          // YYYY-MM-DD (string)
  normalized_at: 1,         // ISO timestamp (kept for optional metrics)
  bond_amount: 1,           // Number
  offense: 1,
  booking_number: 1,
  case_number: 1,
  spn: 1,
};

// -------- Booking-day helpers (TZ-safe, no UTC skew) --------
const DASHBOARD_TZ = process.env.DASHBOARD_TZ || 'America/Chicago'; // Texas counties default
const _ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function ymdInTZ(date) {
  // Returns 'YYYY-MM-DD' formatted in DASHBOARD_TZ
  return _ymdFmt.format(date); // en-CA outputs YYYY-MM-DD
}

function dayShift(n) {
  // Returns YYYY-MM-DD for (today - n days) in DASHBOARD_TZ
  const now = new Date();
  const shifted = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  return ymdInTZ(shifted);
}

function rangeDayStrs(daysBack) {
  const out = [];
  for (let i = 0; i < daysBack; i++) out.push(dayShift(i));
  return out;
}

async function countByBookingDates(db, dates) {
  if (!dates.length) return 0;
  const first = COUNTY_COLLECTIONS[0];
  const cur = db.collection(first).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { _id: 1 }),
    { $count: 'n' }
  ]);
  const doc = await cur.next();
  return doc ? doc.n : 0;
}

async function bondByCountyForDates(db, dates) {
  if (!dates.length) return [];
  const first = COUNTY_COLLECTIONS[0];
  return db.collection(first).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { county: 1, bond_amount: 1 }),
    { $group: { _id: '$county', value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
    { $project: { _id: 0, county: '$_id', value: 1 } },
    { $sort: { county: 1 } }
  ]).toArray();
}

function windowDates(window = '24h') {
  switch ((window || '24h').toLowerCase()) {
    case '24h': return [dayShift(0)];
    case '48h': return [dayShift(1)];
    case '72h': return [dayShift(2)];
    case 'rolling72': return [dayShift(0), dayShift(1), dayShift(2)];
    case '7d':  return rangeDayStrs(7);     // today .. today-6
    case '30d': return rangeDayStrs(30);    // today .. today-29
    default:    return [dayShift(0)];
  }
}

// ---------- KPIs (booking_date driven) ----------
r.get('/kpis', async (req, res) => {
  const db = mongoose.connection.db;

  const today     = [dayShift(0)];
  const yesterday = [dayShift(1)];
  const twoDays   = [dayShift(2)];
  const last7     = rangeDayStrs(7);
  const last30    = rangeDayStrs(30);

  const [cToday, cYesterday, cTwoDays, c7, c30] = await Promise.all([
    countByBookingDates(db, today),
    countByBookingDates(db, yesterday),
    countByBookingDates(db, twoDays),
    countByBookingDates(db, last7),
    countByBookingDates(db, last30),
  ]);

  // NEW: allow selecting the bond sum window via query (24h|48h|72h|rolling72)
  const bondWindow = (req.query.bondWindow || '24h').toLowerCase();
  const bondDates = windowDates(bondWindow);
  const rawBond = await bondByCountyForDates(db, bondDates);

  // Normalize to include all counties with 0s so the UI always has 5 rows.
  const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
  const bondMap = new Map(rawBond.map(r => [r.county, r.value]));
  const perCountyBondToday = counties.map(county => ({
    county,
    value: bondMap.get(county) || 0,
  }));
  const bondTodayTotal = perCountyBondToday.reduce((sum, r) => sum + (r.value || 0), 0);

  // optional: last pull timestamps if you record jobs
  let perCountyLastPull = [];
  try {
    perCountyLastPull = await Job.aggregate([
      { $match: { name: { $regex: /^scrape:/ }, status: 'success' } },
      { $group: { _id: '$name', lastPull: { $max: '$finishedAt' } } },
      { $project: { county: { $replaceOne: { input: '$_id', find: 'scrape:', replacement: '' } }, lastPull: 1, _id: 0 } },
    ]);
  } catch { /* ignore if not present */ }

  res.json({
    newCountsBooked: {
      today: cToday,           // 0–24h by booking_date
      yesterday: cYesterday,   // 24–48h
      twoDaysAgo: cTwoDays,    // 48–72h
      last7d: c7,              // rolling 7 days (calendar)
      last30d: c30             // rolling 30 days (calendar)
    },
    perCountyBondToday,
    bondTodayTotal,
    perCountyLastPull
  });
});

// ---------- TOP (booking window by value) ----------
r.get('/top', async (req, res) => {
  const db = mongoose.connection.db;
  const limit = parseInt(req.query.limit || '10', 10);
  const requestedWindow = String(req.query.window || '24h').toLowerCase();
  let dates = windowDates(requestedWindow);

  const first = COUNTY_COLLECTIONS[0];
  const basePipeline = (dts) => ([
    ...unionAll({ booking_date: { $in: dts } }, P),
    { $addFields: { sortValue: { $ifNull: ['$bond_amount', 0] } } },
    { $sort: { sortValue: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: '$full_name',
        county: 1,
        booking_date: 1,
        bond_amount: 1,
        value: '$sortValue'
      }
    }
  ]);

  let items = await db.collection(first).aggregate(basePipeline(dates)).toArray();

  // Fallback: if 24h requested and empty, use yesterday (48h)
  if (requestedWindow === '24h' && items.length === 0) {
    dates = windowDates('48h');
    items = await db.collection(first).aggregate(basePipeline(dates)).toArray();
  }

  res.json(items);
});

// ---------- NEW (today by booking_date) ----------
r.get('/new', async (req, res) => {
  const db = mongoose.connection.db;
  const dates = [dayShift(0)];
  const countyFilter = req.query.county ? { county: req.query.county } : null;

  const pipeline = [
    ...unionAll({ booking_date: { $in: dates } }, P),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
    { $sort: { booking_date: -1, bond_amount: -1 } },
    { $limit: 100 },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        person: '$full_name',
        county: 1,
        booking_date: 1,
        bond: '$bond_amount'
      }
    }
  ];

  const first = COUNTY_COLLECTIONS[0];
  const items = await db.collection(first).aggregate(pipeline).toArray();
  res.json({ items: items.map(i => ({ ...i, contacted: false })) });
});

// ---------- RECENT (48–72h by booking_date → yesterday + twoDaysAgo) ----------
r.get('/recent', async (_req, res) => {
  const db = mongoose.connection.db;
  const dates = [dayShift(1), dayShift(2)];

  const first = COUNTY_COLLECTIONS[0];
  const items = await db.collection(first).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, P),
    { $sort: { booking_date: -1, bond_amount: -1 } },
    { $limit: 100 },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        person: '$full_name',
        county: 1,
        booking_date: 1,
        bond: '$bond_amount',
        contacted: { $literal: false }
      }
    }
  ]).toArray();

  res.json({ items });
});

// ---------- TRENDS (per-county daily counts & bond totals over last N days) ----------
r.get('/trends', async (req, res) => {
  const db = mongoose.connection.db;
  const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 60); // 1..60
  const dates = rangeDayStrs(days); // [today .. today-(days-1)]

  const first = COUNTY_COLLECTIONS[0];
  const rows = await db.collection(first).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { county: 1, booking_date: 1, bond_amount: 1 }),
    {
      $group: {
        _id: { county: '$county', date: '$booking_date' },
        count: { $sum: 1 },
        bondSum: { $sum: { $ifNull: ['$bond_amount', 0] } },
      }
    },
    { $project: { _id: 0, county: '$_id.county', date: '$_id.date', count: 1, bondSum: 1 } },
    { $sort: { date: 1, county: 1 } }
  ]).toArray();

  // Ensure we return explicit zeros for missing (county, date) combinations if needed by UI
  // For now, return sparse rows; the frontend can fill gaps.
  res.json({ days, dates: dates.reverse(), rows }); // dates newest-last to match ascending sort
});

// ---------- PER-COUNTY SNAPSHOT (booking-day windows) ----------
r.get('/per-county', async (req, res) => {
  try {
    const db = mongoose.connection.db;

    const todayDates = [dayShift(0)];
    const yestDates  = [dayShift(1)];
    const twoDates   = [dayShift(2)];
    const last7      = rangeDayStrs(7);
    const last30     = rangeDayStrs(30);

    // NEW: window for bond sums on this endpoint (24h|48h|72h|rolling72)
    const bondWindow = (req.query.window || '24h').toLowerCase();
    const bondDates = windowDates(bondWindow);

    const first = COUNTY_COLLECTIONS[0];

    // helper to build a map { county -> count } for a set of booking dates
    async function countMap(dates) {
      if (!dates.length) return new Map();
      const rows = await db.collection(first).aggregate([
        ...unionAll({ booking_date: { $in: dates } }, { county: 1 }),
        { $group: { _id: '$county', n: { $sum: 1 } } },
        { $project: { _id: 0, county: '$_id', n: 1 } }
      ]).toArray();
      return new Map(rows.map(r => [r.county, r.n]));
    }

    // bond sum for window per county
    async function bondMapForWindow() {
      const rows = await db.collection(first).aggregate([
        ...unionAll({ booking_date: { $in: bondDates } }, { county: 1, bond_amount: 1 }),
        { $group: { _id: '$county', value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
        { $project: { _id: 0, county: '$_id', value: 1 } }
      ]).toArray();
      return new Map(rows.map(r => [r.county, r.value]));
    }

    const [mToday, mYest, mTwo, m7, m30, mBondWindow] = await Promise.all([
      countMap(todayDates),
      countMap(yestDates),
      countMap(twoDates),
      countMap(last7),
      countMap(last30),
      bondMapForWindow(),
    ]);

    // Normalize county list from collection names (e.g., 'simple_harris' -> 'harris')
    const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
    const items = counties.map(county => ({
      county,
      counts: {
        today: mToday.get(county) || 0,
        yesterday: mYest.get(county) || 0,
        twoDaysAgo: mTwo.get(county) || 0,
        last7d: m7.get(county) || 0,
        last30d: m30.get(county) || 0,
      },
        bondToday: mBondWindow.get(county) || 0,
    }));

    res.json({ items });
  } catch (err) {
    console.error('per-county error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default r;