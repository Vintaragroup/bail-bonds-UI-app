// server/src/routes/dashboard.js
import { Router } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';   // optional
import Job from '../models/Job.js';           // optional

const r = Router();

const COUNTY_COLLECTIONS = [
  'simple_brazoria',
  'simple_fortbend',
  'simple_galveston',
  'simple_harris',
  'simple_jefferson',
];

// Use the first collection only as an entry point for $unionWith
const BASE_COLLECTION = COUNTY_COLLECTIONS[0];
const baseColl = (db) => db.collection(BASE_COLLECTION);

/**
 * Build a $unionWith pipeline across all simple_* collections, with:
 *  - booking_date normalization (YYYY-MM-DD string)
 *  - robust bond_amount normalization (numeric)
 *  - county fallback
 *  - global exclusion of Harris/Civil rows
 */
function unionAll(match = {}, project = null) {
  // Normalize booking_date & bond_amount
  const normalizeStages = [
    {
      $set: {
        // Prefer normalized booking_date; fall back to legacy fields if present
        booking_date_n: {
          $ifNull: [
            '$booking_date',
            { $ifNull: ['$booked_at', '$booking_date_iso'] }
          ]
        },
        // Compute a reliable numeric bond amount:
        // 1) use bond_amount if already numeric
        // 2) else use numeric bond if bond is a number
        // 3) else cast numeric-looking bond strings
        // 4) else null (e.g., "REFER TO MAGISTRATE")
        bond_amount_n: {
          $let: {
            vars: {
              bAmt: '$bond_amount',
              b: '$bond',
              bl: { $toString: { $ifNull: ['$bond_label', ''] } },
            },
            in: {
              $switch: {
                branches: [
                  { case: { $ne: ['$$bAmt', null] }, then: '$$bAmt' },
                  { case: { $isNumber: '$$b' },       then: '$$b' },
                  {
                    case: {
                      $regexMatch: {
                        input: { $toString: '$$b' },
                        regex: /^\d+(\.\d+)?$/,
                      }
                    },
                    then: { $toDouble: '$$b' }
                  },
                  {
                    case: {
                      $regexMatch: {
                        input: '$$bl',
                        regex: /REFER TO MAGISTRATE/i
                      }
                    },
                    then: null
                  },
                ],
                default: null,
              }
            }
          }
        }
      }
    },
    {
      // Canonicalize so downstream always sees booking_date & bond_amount
      $set: {
        booking_date: '$booking_date_n',
        bond_amount: '$bond_amount_n',
      }
    },
    // Compute-on-read extras: preserve raw bond text, classify non-numeric bonds,
    // and provide a sort-weight for ranking. This keeps original semantics
    // for numeric aggregation while exposing useful metadata.
    {
      $set: {
          bond_raw: {
            $ifNull: [
              '$bond_raw',
              { $toString: { $ifNull: ['$bond', { $ifNull: ['$bond_label', ''] }] } }
            ]
          },
          bond_status: {
            $ifNull: ['$bond_status', {
              $switch: {
                branches: [
                  { case: { $ne: ['$bond_amount_n', null] }, then: 'numeric' },
                  { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /REFER TO MAGISTRATE/i } }, then: 'refer_to_magistrate' },
                  { case: { $regexMatch: { input: { $toString: '$bond' }, regex: /REFER TO MAGISTRATE/i } }, then: 'refer_to_magistrate' },
                  { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /SUMMONS/i } }, then: 'summons' },
                  { case: { $regexMatch: { input: { $toString: '$bond' }, regex: /SUMMONS/i } }, then: 'summons' },
                  { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /UNSECURED|GOB/i } }, then: 'unsecured' },
                  { case: { $eq: [{ $toString: { $ifNull: ['$bond', ''] } }, ''] }, then: 'no_bond' }
                ],
                default: 'unknown_text'
              }
            }]
          },
          bond_sort_value: {
            $ifNull: ['$bond_sort_value', {
              $switch: {
                branches: [
                  { case: { $eq: ['$bond_status', 'numeric'] }, then: { $ifNull: ['$bond_amount_n', 0] } },
                  // keep refer-to-magistrate visible but don't pollute numeric totals
                  { case: { $eq: ['$bond_status', 'refer_to_magistrate'] }, then: 1000000000 },
                  { case: { $eq: ['$bond_status', 'unsecured'] }, then: 100 },
                  { case: { $eq: ['$bond_status', 'summons'] }, then: 0 }
                ],
                default: 0
              }
            }]
          }
        }
    },
  ];

  const collCounty = (name) => (name || '').replace(/^simple_/, '') || 'unknown';

  // Apply normalization + county fallback + exclude Harris Civil globally
  const headStages = [
    ...normalizeStages,
    // canonicalize county text to lowercase/trim to avoid mismatches
    { $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', collCounty(BASE_COLLECTION)] } } } } } },
    { $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } },
  ];

  // If caller filters booking_date, map it to normalized field
  const rewrittenMatch = (() => {
    if (match && Object.prototype.hasOwnProperty.call(match, 'booking_date')) {
      const m = { ...match };
      m.booking_date_n = m.booking_date;
      delete m.booking_date;
      return m;
    }
    return match || {};
  })();

  const stages = headStages.concat([{ $match: rewrittenMatch }]);
  if (project) stages.push({ $project: project });

  // Build union branches for the remaining collections
  const unions = COUNTY_COLLECTIONS.slice(1).map((coll) => ({
    $unionWith: {
      coll,
      pipeline: []
        .concat(normalizeStages)
        .concat([{ $set: { county: { $ifNull: ['$county', collCounty(coll)] } } }])
        .concat([{ $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } }])
        .concat([{ $match: rewrittenMatch }])
        .concat(project ? [{ $project: project }] : []),
    }
  }));

  return stages.concat(unions);
}

// Common projection shared by endpoints
const P = {
  _id: 1,
  county: 1,
  category: 1,
  full_name: 1,
  booking_date: 1,
  normalized_at: 1,
  bond_amount: 1,
  bond_raw: 1,
  bond_status: 1,
  bond_sort_value: 1,
  bond_label: 1,
  bond: 1,
  charge: 1,
  booking_number: 1,
  case_number: 1,
  spn: 1,
  agency: 1,
  facility: 1,
  race: 1,
  sex: 1,
};

// Per-file DB timeout for potentially expensive aggregations
const MAX_DB_MS = 5000;

// Helper to timeout a promise-returning DB operation so endpoints don't hang
function withTimeout(promise, ms = MAX_DB_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('operation timed out')), ms)),
  ]);
}

// Ensure a DB is available for this request; otherwise respond 503.
function ensureDb(res) {
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) {
    res.status(503).json({ error: 'Database not connected. Set MONGO_URI and (optionally) MONGO_DB.' });
    return null;
  }
  return db;
}

async function fetchContactedCaseIds(caseIds = []) {
  if (!caseIds.length) return { contactSet: new Set(), lastMap: new Map() };

  const conn = mongoose.connection;
  if (!conn || !conn.db) return { contactSet: new Set(), lastMap: new Map() };

  const objectIds = Array.from(new Set(caseIds.map((id) => String(id || ''))))
    .map((raw) => {
      if (!raw) return null;
      try {
        return new mongoose.Types.ObjectId(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!objectIds.length) return { contactSet: new Set(), lastMap: new Map() };

  let coll;
  try {
    coll = conn.db.collection('messages');
  } catch {
    coll = null;
  }

  if (!coll) return { contactSet: new Set(), lastMap: new Map() };

  const agg = coll.aggregate([
    { $match: { caseId: { $in: objectIds } } },
    {
      $group: {
        _id: '$caseId',
        hasOut: {
          $max: {
            $cond: [
              { $eq: ['$direction', 'out'] },
              1,
              0
            ]
          }
        },
        lastContact: {
          $max: {
            $ifNull: ['$sentAt', { $ifNull: ['$deliveredAt', { $ifNull: ['$createdAt', '$updatedAt'] }] }]
          }
        }
      }
    }
  ]);
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
  const docs = await withTimeout(cursor.toArray(), MAX_DB_MS).catch(() => []);
  const contactSet = new Set();
  const lastMap = new Map();
  docs.forEach((d) => {
    const id = String(d?._id);
    if (!id) return;
    if (d?.hasOut) contactSet.add(id);
    if (d?.lastContact) lastMap.set(id, d.lastContact);
  });
  return { contactSet, lastMap };
}

// ----- Date helpers (timezone aware) -----
const DASHBOARD_TZ = process.env.DASHBOARD_TZ || 'America/Chicago';
const _ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const ymdInTZ = (d) => _ymdFmt.format(d); // en-CA => YYYY-MM-DD
const dayShift = (n) => ymdInTZ(new Date(Date.now() - n * 86400000));
const rangeDayStrs = (n) => Array.from({ length: n }, (_, i) => dayShift(i));

function windowDates(win = '24h') {
  switch ((win || '24h').toLowerCase()) {
    case '24h': return [dayShift(0)];
    case '48h': return [dayShift(1)];
    case '72h': return [dayShift(2)];
    case 'rolling72': return [dayShift(0), dayShift(1), dayShift(2)];
    case '7d':  return rangeDayStrs(7);
    case '30d': return rangeDayStrs(30);
    default:    return [dayShift(0)];
  }
}

async function countByBookingDates(db, dates) {
  if (!dates.length) return 0;
  const cur = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { _id: 1 }),
    { $count: 'n' }
  ]).maxTimeMS ? baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { _id: 1 }),
    { $count: 'n' }
  ]).maxTimeMS(MAX_DB_MS) : baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { _id: 1 }),
    { $count: 'n' }
  ]);
  const doc = await withTimeout(cur.next(), MAX_DB_MS).catch(() => null);
  return doc ? doc.n : 0;
}

async function bondByCountyForDates(db, dates) {
  if (!dates.length) return [];
  const agg = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { county: 1, bond_amount: 1 }),
    { $group: { _id: '$county', value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
    { $project: { _id: 0, county: '$_id', value: 1 } },
    { $sort: { county: 1 } }
  ]);
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
  return withTimeout(cursor.toArray(), MAX_DB_MS).catch(() => []);
}

async function adaptiveBondByCounty(db, preferred = ['24h', '48h', '72h', '7d']) {
  const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
  const results = new Map();
  for (const win of preferred) {
    const rows = await bondByCountyForDates(db, windowDates(win)).catch(() => []);
    results.set(win, new Map(rows.map(r => [r.county, r.value || 0])));
  }
  const out = [];
  for (const county of counties) {
    let used = preferred[preferred.length - 1];
    let value = 0;
    for (const win of preferred) {
      const v = results.get(win)?.get(county) || 0;
      used = win;
      if (v > 0) { value = v; break; }
    }
    out.push({ county, value, windowUsed: used });
  }
  return out;
}

// ---- Attention flags (refer-to-magistrate or letter suffix in case number) ----
function attentionStages(attentionOnly = false) {
  const st = [
    { $set: {
        _bl: { $toString: { $ifNull: ['$bond_label', ''] } },
        _b:  { $toString: { $ifNull: ['$bond', ''] } },
        _cn: { $toString: { $ifNull: ['$case_number', ''] } },
      }},
    { $set: {
        isReferMag: {
          $or: [
            { $regexMatch: { input: '$_bl', regex: /REFER TO MAGISTRATE/i } },
            { $regexMatch: { input: '$_b',  regex: /REFER TO MAGISTRATE/i } }
          ]
        },
        // Only flag case numbers that end with an ASCII letter (e.g., '12345A')
        hasLetterCase: {
          $and: [
            { $ne: ['$_cn', ''] },
            { $regexMatch: { input: '$_cn', regex: /[A-Za-z]$/ } }
          ]
        }
      }},
    { $set: {
        needs_attention: { $or: ['$isReferMag', '$hasLetterCase'] },
        attention_reasons: {
          $setDifference: [
            [
              { $cond: ['$$REMOVE', null, null] },
              { $cond: ['$isReferMag', 'refer_to_magistrate', null] },
              { $cond: ['$hasLetterCase', 'letter_suffix_case', null] },
            ],
            [null]
          ]
        }
      }},
    { $unset: ['_bl', '_b', '_cn'] }
  ];
  if (attentionOnly) st.push({ $match: { needs_attention: true } });
  return st;
}

// ===== KPIs =====
r.get('/kpis', async (_req, res) => {
  const db = ensureDb(res); if (!db) return;
  const [cToday, cYesterday, cTwoDays, c7, c30] = await Promise.all([
    countByBookingDates(db, [dayShift(0)]),
    countByBookingDates(db, [dayShift(1)]),
    countByBookingDates(db, [dayShift(2)]),
    countByBookingDates(db, rangeDayStrs(7)),
    countByBookingDates(db, rangeDayStrs(30)),
  ]);
  const perCountyBond = await adaptiveBondByCounty(db, ['24h', '48h', '72h', '7d']);
  const bondTotal = perCountyBond.reduce((s, r) => s + (r.value || 0), 0);

  let perCountyLastPull = [];
  try {
    const aggJob = Job.aggregate([
      { $match: { name: { $regex: /^scrape:/ }, status: 'success' } },
      { $group: { _id: '$name', lastPull: { $max: '$finishedAt' } } },
      { $project: { county: { $replaceOne: { input: '$_id', find: 'scrape:', replacement: '' } }, lastPull: 1, _id: 0 } },
    ]);
    perCountyLastPull = await withTimeout((aggJob.maxTimeMS ? aggJob.maxTimeMS(MAX_DB_MS) : aggJob).toArray(), MAX_DB_MS).catch(() => []);
  } catch { /* optional */ }

  let contacted24h = { contacted: 0, total: cToday, rate: 0 };
  try {
    const today = dayShift(0);
    const aggTodayIds = baseColl(db).aggregate([
      ...unionAll({ booking_date: today }, { _id: 1 }),
    ]);
    const todayDocs = await withTimeout((aggTodayIds.maxTimeMS ? aggTodayIds.maxTimeMS(MAX_DB_MS) : aggTodayIds).toArray(), MAX_DB_MS).catch(() => []);
    const todayIds = todayDocs.map((d) => d._id).filter(Boolean);
    const totalUnique = new Set(todayIds.map((id) => String(id))).size;
    if (totalUnique) {
      const meta = await fetchContactedCaseIds(todayIds);
      const contacted = meta.contactSet.size;
      contacted24h = {
        contacted,
        total: totalUnique,
        rate: totalUnique ? contacted / totalUnique : 0,
      };
    }
  } catch (err) {
    console.warn('kpis: contacted24h computation failed', err?.message);
  }

  res.json({
    newCountsBooked: {
      today: cToday,
      yesterday: cYesterday,
      twoDaysAgo: cTwoDays,
      last7d: c7,
      last30d: c30,
    },
    perCountyBond,
    bondTotal,
    perCountyBondToday: perCountyBond.map(({ county, value }) => ({ county, value })),
    bondTodayTotal: bondTotal,
    perCountyLastPull,
    contacted24h,
  });
});

// ===== TOP (by bond value, booking window) =====
r.get('/top', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const requestedWindow = String(req.query.window || '24h').toLowerCase();
  let dates = windowDates(requestedWindow);
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  let windowUsed = requestedWindow;

  const basePipeline = (dts) => ([
    ...unionAll({ booking_date: { $in: dts } }, P),
    ...attentionStages(req.query.attention === '1' || req.query.attention === 'true'),
  ...(countyFilter ? [{ $match: countyFilter }] : []),
  { $set: { sortValue: { $cond: [ { $isNumber: '$bond_amount' }, '$bond_amount', { $toDouble: { $ifNull: ['$bond', 0] } } ] } } },
    { $sort: { sortValue: -1 } },
    { $limit: limit },
    { $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: '$full_name',
        county: 1,
        category: 1,
        booking_date: 1,
  bond_amount: 1,
        value: '$sortValue',
        offense: '$charge',
        agency: 1,
        facility: 1,
        race: 1,
        sex: 1,
        case_number: 1,
        spn: 1,
        needs_attention: 1,
        attention_reasons: 1,
      }}
  ]);

  const aggItemsTop = baseColl(db).aggregate(basePipeline(dates));
  let items = await withTimeout((aggItemsTop.maxTimeMS ? aggItemsTop.maxTimeMS(MAX_DB_MS) : aggItemsTop).toArray(), MAX_DB_MS).catch(() => []);
  if (requestedWindow === '24h' && items.length === 0) {
    dates = windowDates('48h');
    const agg2 = baseColl(db).aggregate(basePipeline(dates));
    items = await withTimeout((agg2.maxTimeMS ? agg2.maxTimeMS(MAX_DB_MS) : agg2).toArray(), MAX_DB_MS).catch(() => []);
    if (items.length) windowUsed = '48h';
  }
  if (items.length) {
    const meta = await fetchContactedCaseIds(items.map((it) => it.id));
    items = items.map((item) => ({
      ...item,
      contacted: meta.contactSet.has(String(item.id)),
      last_contact_at: meta.lastMap.get(String(item.id)) || null,
      window_used: windowUsed,
    }));
  }
  res.json(items);
});

// ===== NEW (today) =====
r.get('/new', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const dates = [dayShift(0)];
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);

  const aggItemsNew = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, P),
    ...attentionStages(req.query.attention === '1' || req.query.attention === 'true'),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
    { $sort: { booking_date: -1, bond_amount: -1 } },
    { $limit: limit },
    { $project: {
        _id: 0,
        id: { $toString: '$_id' },
        person: '$full_name',
        county: 1,
        category: 1,
        booking_date: 1,
        bond_amount: '$bond_amount',
        bond: '$bond',
        offense: '$charge',
        agency: 1,
        facility: 1,
        race: 1,
        sex: 1,
        case_number: 1,
        spn: 1,
        bond_status: 1,
        bond_raw: 1,
        needs_attention: 1,
        attention_reasons: 1,
      }}
    ]);
  const rawItems = await withTimeout((aggItemsNew.maxTimeMS ? aggItemsNew.maxTimeMS(MAX_DB_MS) : aggItemsNew).toArray(), MAX_DB_MS).catch(() => []);
  const metaNew = await fetchContactedCaseIds(rawItems.map((it) => it.id));
  const items = rawItems.map((it) => ({
    ...it,
    contacted: metaNew.contactSet.has(String(it.id)),
    last_contact_at: metaNew.lastMap.get(String(it.id)) || null,
  }));
  const contactedCountNew = items.filter((it) => it.contacted).length;
  const summary = {
    total: items.length,
    contacted: contactedCountNew,
    uncontacted: items.length - contactedCountNew,
  };

  const aggTicker = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { county: 1 }),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
    { $group: { _id: '$county', n: { $sum: 1 } } },
    { $project: { _id: 0, county: '$_id', n: 1 } },
    { $sort: { county: 1 } }
  ]);
  const ticker = await withTimeout((aggTicker.maxTimeMS ? aggTicker.maxTimeMS(MAX_DB_MS) : aggTicker).toArray(), MAX_DB_MS).catch(() => []);

  res.json({ items, ticker, summary });
});

// ===== RECENT (48–72h window) =====
r.get('/recent', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const dates = [dayShift(1), dayShift(2)];

  async function sumBond(dts) {
    if (!dts.length) return 0;
    const agg = baseColl(db).aggregate([
      ...unionAll({ booking_date: { $in: dts } }, { bond_amount: 1 }),
      { $group: { _id: null, total: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
      { $project: { _id: 0, total: 1 } }
    ]);
    const rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);
    return rows.length ? rows[0].total : 0;
  }

  const [count48h, count72h, bond48h, bond72h] = await Promise.all([
    countByBookingDates(db, [dayShift(1)]),
    countByBookingDates(db, [dayShift(2)]),
    sumBond([dayShift(1)]),
    sumBond([dayShift(2)]),
  ]);

  const aggItemsRecent = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, P),
    ...attentionStages(req.query.attention === '1' || req.query.attention === 'true'),
    { $sort: { booking_date: -1, bond_amount: -1 } },
    { $limit: limit },
    { $project: {
        _id: 0,
        id: { $toString: '$_id' },
        person: '$full_name',
        county: 1,
        category: 1,
        booking_date: 1,
        bond_amount: '$bond_amount',
        bond: '$bond',
        offense: '$charge',
        agency: 1,
        facility: 1,
        race: 1,
        sex: 1,
        case_number: 1,
        spn: 1,
        needs_attention: 1,
        attention_reasons: 1,
        bond_status: 1,
        bond_raw: 1,
      }}
  ]);
  const rawItemsRecent = await withTimeout((aggItemsRecent.maxTimeMS ? aggItemsRecent.maxTimeMS(MAX_DB_MS) : aggItemsRecent).toArray(), MAX_DB_MS).catch(() => []);
  const metaRecent = await fetchContactedCaseIds(rawItemsRecent.map((it) => it.id));
  const items = rawItemsRecent.map((it) => ({
    ...it,
    contacted: metaRecent.contactSet.has(String(it.id)),
    last_contact_at: metaRecent.lastMap.get(String(it.id)) || null,
  }));
  const contactedRecent = items.filter((it) => it.contacted).length;

  res.json({
    items,
    summary: {
      totalCount: count48h + count72h,
      count48h,
      count72h,
      bond48h,
      bond72h,
      bondTotal: bond48h + bond72h,
      contacted: contactedRecent,
      uncontacted: items.length - contactedRecent,
    },
    ticker: await (async () => {
      const aggT = baseColl(db).aggregate([
        ...unionAll({ booking_date: { $in: dates } }, { county: 1 }),
        { $group: { _id: '$county', n: { $sum: 1 } } },
        { $project: { _id: 0, county: '$_id', n: 1 } },
        { $sort: { county: 1 } }
      ]);
      return await withTimeout((aggT.maxTimeMS ? aggT.maxTimeMS(MAX_DB_MS) : aggT).toArray(), MAX_DB_MS).catch(() => []);
    })(),
  });
});

// ===== TRENDS (last N calendar days) =====
r.get('/trends', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 60);
  const dates = rangeDayStrs(days); // oldest-first

  const agg = baseColl(db).aggregate([
    ...unionAll({ booking_date: { $in: dates } }, { county: 1, booking_date: 1, bond_amount: 1 }),
    {
      $group: {
        _id: { county: '$county', date: '$booking_date' },
        count:   { $sum: 1 },
        bondSum: { $sum: { $ifNull: ['$bond_amount', 0] } },
      }
    },
    { $project: { _id: 0, county: '$_id.county', date: '$_id.date', count: 1, bondSum: 1 } }
  ]);
  const rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);

  const allCounties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
  const key = (c, d) => `${c}__${d}`;
  const seen = new Map(rows.map(r => [key(r.county, r.date), r]));
  const filled = [];

  for (const d of dates) {
    for (const c of allCounties) {
      filled.push(seen.get(key(c, d)) || { county: c, date: d, count: 0, bondSum: 0 });
    }
  }

  // Send newest-last for charts
  res.json({
    days,
    dates: dates.slice().reverse(),
    rows: filled.sort((a, b) =>
      a.date > b.date ? 1 : a.date < b.date ? -1 : a.county.localeCompare(b.county)
    )
  });
});

// ===== PER-COUNTY snapshot =====
r.get('/per-county', async (req, res) => {
  try {
    const db = ensureDb(res); if (!db) return;
    const today   = [dayShift(0)];
    const yest    = [dayShift(1)];
    const two     = [dayShift(2)];
    const last7   = rangeDayStrs(7);
    const last30  = rangeDayStrs(30);
    const win     = (req.query.window || '24h').toLowerCase();
    const winDates = windowDates(win);

    const countMap = async (dts) => {
      if (!dts.length) return new Map();
      const agg = baseColl(db).aggregate([
        ...unionAll({ booking_date: { $in: dts } }, { county: 1 }),
        { $group: { _id: '$county', n: { $sum: 1 } } },
        { $project: { _id: 0, county: '$_id', n: 1 } }
      ]);
      const rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);
      return new Map(rows.map(r => [r.county, r.n]));
    };

    const bondMap = async () => {
      const agg = baseColl(db).aggregate([
        ...unionAll({ booking_date: { $in: winDates } }, { county: 1, bond_amount: 1 }),
        { $group: { _id: '$county', value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
        { $project: { _id: 0, county: '$_id', value: 1 } }
      ]);
      const rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);
      return new Map(rows.map(r => [r.county, r.value]));
    };

    const [mT, mY, mTwo, m7, m30, mBond] = await Promise.all([
      countMap(today),
      countMap(yest),
      countMap(two),
      countMap(last7),
      countMap(last30),
      bondMap(),
    ]);

    const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
    const items = counties.map(cty => ({
      county: cty,
      counts: {
        today:      mT.get(cty)   || 0,
        yesterday:  mY.get(cty)   || 0,
        twoDaysAgo: mTwo.get(cty) || 0,
        last7d:     m7.get(cty)   || 0,
        last30d:    m30.get(cty)  || 0,
      },
      bondValue: mBond.get(cty) || 0,
      bondToday: mBond.get(cty) || 0, // legacy
    }));

    res.json({ items, windowUsed: win });
  } catch (err) {
    console.error('per-county error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default r;
