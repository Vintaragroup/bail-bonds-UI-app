/* eslint-env node */
/* global process */
// server/src/routes/dashboard.js
import { Router } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';   // optional
import Job from '../models/Job.js';           // optional

const r = Router();

// --- Perf timing middleware (router-local) ---
r.use((req, res, next) => {
  const start = process.hrtime.bigint();
  // expose helper for handlers to mark custom timings later if needed
  res.locals._perfMarks = [];
  res.locals.perfMark = (label) => {
    try {
      const now = process.hrtime.bigint();
      res.locals._perfMarks.push({ label, ms: Number(now - start) / 1e6 });
    } catch { /* noop */ }
  };
  res.on('finish', () => {
    try {
      const end = process.hrtime.bigint();
      const totalMs = Number(end - start) / 1e6;
      res.setHeader('X-Perf-Total', totalMs.toFixed(1));
      if (res.locals._perfMarks?.length) {
        const compact = res.locals._perfMarks.map(m => `${m.label}:${m.ms.toFixed(1)}`).join(',');
        res.setHeader('X-Perf-Marks', compact);
      }
    } catch { /* best-effort */ }
  });
  next();
});

// --- Tiny in-memory cache to avoid stampedes during development ---
const CACHE_TTL_MS = parseInt(process.env.DASH_CACHE_MS || '30000', 10);
const _cache = new Map(); // key -> { ts, data }
const _inflight = new Map(); // key -> Promise

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}

async function withCache(key, compute) {
  const hit = cacheGet(key);
  if (hit !== null) return { fromCache: true, data: hit };
  if (_inflight.has(key)) {
    try {
      const data = await _inflight.get(key);
      return { fromCache: true, data };
    } catch (e) {
      // fall through to recompute
    }
  }
  const p = (async () => await compute())();
  _inflight.set(key, p);
  try {
    const data = await p;
    cacheSet(key, data);
    return { fromCache: false, data };
  } finally {
    _inflight.delete(key);
  }
}

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

const DASHBOARD_TZ = process.env.DASHBOARD_TZ || 'America/Chicago';
const _ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const ymdInTZ = (d) => _ymdFmt.format(d); // en-CA => YYYY-MM-DD

const toYmd = (fieldPath) => ({
  $let: {
    vars: {
      value: `$${fieldPath}`,
      asDate: {
        $convert: {
          input: `$${fieldPath}`,
          to: 'date',
          onError: null,
          onNull: null,
        },
      },
      strValue: { $toString: { $ifNull: [`$${fieldPath}`, ''] } },
    },
    in: {
      $cond: [
        {
          $or: [
            { $eq: ['$$value', null] },
            { $eq: [{ $type: '$$value' }, 'missing'] },
            { $eq: ['$$strValue', ''] },
          ],
        },
        null,
        {
          $cond: [
            { $ne: ['$$asDate', null] },
            {
              $dateToString: {
                date: '$$asDate',
                timezone: DASHBOARD_TZ,
                format: '%Y-%m-%d',
              },
            },
            {
              $cond: [
                { $gte: [{ $strLenCP: '$$strValue' }, 10] },
                { $substrCP: ['$$strValue', 0, 10] },
                '$$strValue',
              ],
            },
          ],
        },
      ],
    },
  },
});

const rewriteBookingKeys = (value) => {
  if (Array.isArray(value)) return value.map(rewriteBookingKeys);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const out = {};
  Object.entries(value).forEach(([key, val]) => {
    const nextKey = key === 'booking_date' ? 'booking_date_n' : key;
    out[nextKey] = rewriteBookingKeys(val);
  });
  return out;
};

const HOUR_MS = 60 * 60 * 1000;

const bucketWindowConfig = {
  // Windows are STRICTLY based on booking time now (booking_dt), not recency.
  '24h': { sinceHours: 24 },
  '48h': { sinceHours: 48, prevHours: 24 },
  '72h': { sinceHours: 72, prevHours: 48 },
  // broader ranges used in KPIs; no upper bound
  '7d':  { sinceHours: 24 * 7  },
  '30d': { sinceHours: 24 * 30 },
};

// No time-bucket based matching now; windows derive from booking_dt only

// Day-anchored window matching: 24h = today, 48h = yesterday, 72h = two days ago, etc.
const buildWindowMatch = (win) => {
  const now = new Date();
  const ymd = (d) => ymdInTZ(d);
  const dayMs = 24 * 3600000;
  const ymdAgo = (n) => ymd(new Date(now.getTime() - n * dayMs));
  const today = ymdAgo(0);
  const yesterday = ymdAgo(1);
  const twoDays = ymdAgo(2);
  switch ((win || '').toLowerCase()) {
    case '48h': // yesterday
      return { $and: [ { booking_date_n: yesterday }, { category: { $ne: 'Civil' } } ] };
    case '72h': // two days ago
      return { $and: [ { booking_date_n: twoDays }, { category: { $ne: 'Civil' } } ] };
    case '7d': {
      const start = ymdAgo(6); // today plus previous 6 days
      return { $and: [ { booking_date_n: { $gte: start } }, { category: { $ne: 'Civil' } } ] };
    }
    case '30d': {
      const start = ymdAgo(29);
      return { $and: [ { booking_date_n: { $gte: start } }, { category: { $ne: 'Civil' } } ] };
    }
    case '24h':
    default:
      return { $and: [ { booking_date_n: today }, { category: { $ne: 'Civil' } } ] };
  }
};

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
        // Prefer normalized booking_date; fall back to legacy and ingest timestamps
        booking_date_n: {
          $let: {
            vars: {
              candidates: [
                toYmd('booking_date'),
                toYmd('booked_at'),
                toYmd('booking_date_iso'),
                toYmd('normalized_at'),
                toYmd('scraped_at'),
              ],
            },
            in: {
              $let: {
                vars: {
                  filtered: {
                    $filter: {
                      input: '$$candidates',
                      as: 'd',
                      cond: { $and: [{ $ne: ['$$d', null] }, { $ne: ['$$d', ''] }] },
                    },
                  },
                },
                in: {
                  $cond: [
                    { $gt: [{ $size: '$$filtered' }, 0] },
                    { $arrayElemAt: ['$$filtered', 0] },
                    null,
                  ],
                },
              },
            },
          },
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
        },
        scraped_at_dt: {
          $let: {
            vars: {
              v: '$scraped_at',
              t: { $toString: { $ifNull: ['$scraped_at', ''] } },
              ty: { $type: '$scraped_at' },
            },
            in: {
              $cond: [
                { $eq: ['$$ty', 'date'] },
                '$$v',
                {
                  $convert: {
                    input: { $trim: { input: '$$t' } },
                    to: 'date',
                    onError: null,
                    onNull: null,
                  }
                }
              ]
            }
          }
        },
        normalized_at_dt: {
          $let: {
            vars: {
              v: '$normalized_at',
              t: { $toString: { $ifNull: ['$normalized_at', ''] } },
              ty: { $type: '$normalized_at' },
            },
            in: {
              $cond: [
                { $eq: ['$$ty', 'date'] },
                '$$v',
                {
                  $convert: {
                    input: { $trim: { input: '$$t' } },
                    to: 'date',
                    onError: null,
                    onNull: null,
                  }
                }
              ]
            }
          }
        },
        // Compute booking_dt with strict precedence:
        // 1) booking_date_n (canonical day -> midnight local in DASHBOARD_TZ)
        // 2) booking_date_iso (parsed)
        // 3) booked_at (parsed)
        // This avoids stale booked_at shifting records out of the 24h window.
        booking_dt: {
          $let: {
            vars: {
              bookingDay: '$booking_date_n',
              isoRaw: '$booking_date_iso',
              isoTy: { $type: '$booking_date_iso' },
              isoStr: { $toString: { $ifNull: ['$booking_date_iso', ''] } },
              baRaw: '$booked_at',
              baTy: { $type: '$booked_at' },
              baStr: { $toString: { $ifNull: ['$booked_at', ''] } },
            },
            in: {
              $let: {
                vars: {
                  dayDate: {
                    $cond: [
                      { $and: [ { $ne: ['$$bookingDay', null] }, { $ne: ['$$bookingDay', ''] } ] },
                      { $dateFromString: { dateString: '$$bookingDay', format: '%Y-%m-%d', timezone: DASHBOARD_TZ, onError: null, onNull: null } },
                      null
                    ]
                  },
                  isoDate: {
                    $cond: [
                      { $eq: ['$$isoTy', 'date'] },
                      '$$isoRaw',
                      { $convert: { input: { $trim: { input: '$$isoStr' } }, to: 'date', onError: null, onNull: null } }
                    ]
                  },
                  bookedAtDate: {
                    $cond: [
                      { $eq: ['$$baTy', 'date'] },
                      '$$baRaw',
                      { $convert: { input: { $trim: { input: '$$baStr' } }, to: 'date', onError: null, onNull: null } }
                    ]
                  }
                },
                in: { $ifNull: ['$$dayDate', { $ifNull: ['$$isoDate', '$$bookedAtDate'] }] }
              }
            }
          }
        },
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
  const rewrittenMatch = match ? rewriteBookingKeys(match) : {};

  const stages = headStages.concat([{ $match: rewrittenMatch }]);
  if (project) stages.push({ $project: project });

  // Build union branches for the remaining collections
  const unions = COUNTY_COLLECTIONS.slice(1).map((coll) => ({
    $unionWith: {
      coll,
      pipeline: []
        .concat(normalizeStages)
        // match base branch behavior: lowercase/trim county consistently
        .concat([{ $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', collCounty(coll)] } } } } } }])
        .concat([{ $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } }])
        .concat([{ $match: rewrittenMatch }])
        .concat(project ? [{ $project: project }] : []),
    }
  }));

  return stages.concat(unions);
}

/**
 * A lightweight variant of unionAll used for count/sum style queries to avoid
 * expensive per-document computations we don't need. It computes only the
 * fields required for the specific operation based on opts:
 *  - needBooking: normalize booking_date -> booking_date_n and alias booking_date
 *  - needTimeBucket: lower/trim time_bucket -> time_bucket_n (string)
 *  - needBond: derive a numeric bond_amount_n with a simplified parser and
 *              alias bond_amount
 */
function unionAllFast(match = {}, project = null, opts = {}) {
  const { needBooking = false, needTimeBucket = false, needBond = false, needBookingDt = false } = opts;

  // Extract coarse date range from booking_dt for early raw filter
  function extractRange(m) {
    if (!needBookingDt || !m || typeof m !== 'object') return null;
    const scan = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      const r = obj.booking_dt;
      if (!r || typeof r !== 'object') return null;
      const gte = r.$gte instanceof Date ? r.$gte : null;
      const lt = r.$lt instanceof Date ? r.$lt : null;
      if (!gte && !lt) return null;
      const minus1d = (d) => new Date(d.getTime() - 24*3600000);
      const plus1d = (d) => new Date(d.getTime() + 24*3600000);
      const out = {};
      if (gte) out.$gte = ymdInTZ(minus1d(gte));
      if (lt) out.$lte = ymdInTZ(plus1d(lt));
      return Object.keys(out).length ? out : null;
    };
    let out = scan(m); if (out) return out;
    if (Array.isArray(m.$and)) {
      for (const part of m.$and) { const got = scan(part); if (got) return got; }
    }
    return null;
  }
  const coarseYmd = extractRange(match);

  const baseSet = {
    scraped_at_dt: { $let: { vars: { v: '$scraped_at', t: { $toString: { $ifNull: ['$scraped_at', ''] } }, ty: { $type: '$scraped_at' } }, in: { $cond: [ { $eq: ['$$ty', 'date'] }, '$$v', { $convert: { input: { $trim: { input: '$$t' } }, to: 'date', onError: null, onNull: null } } ] } } },
    normalized_at_dt: { $let: { vars: { v: '$normalized_at', t: { $toString: { $ifNull: ['$normalized_at', ''] } }, ty: { $type: '$normalized_at' } }, in: { $cond: [ { $eq: ['$$ty', 'date'] }, '$$v', { $convert: { input: { $trim: { input: '$$t' } }, to: 'date', onError: null, onNull: null } } ] } } },
  };
  if (needBooking || needBookingDt) {
    baseSet.booking_date_n = { $let: { vars: { c1: toYmd('booking_date'), c2: toYmd('booking_date_iso'), c3: toYmd('booked_at') }, in: { $ifNull: ['$$c1', { $ifNull: ['$$c2', '$$c3'] }] } } };
  }
  if (needTimeBucket) {
    baseSet.time_bucket_n = { $let: { vars: { tb: { $toString: { $ifNull: ['$time_bucket', ''] } } }, in: { $cond: [ { $eq: ['$$tb', ''] }, null, { $toLower: { $trim: { input: '$$tb' } } } ] } } };
  }
  if (needBond) {
    baseSet.bond_amount_n = { $let: { vars: { bAmt: '$bond_amount', b: '$bond' }, in: { $switch: { branches: [ { case: { $ne: ['$$bAmt', null] }, then: '$$bAmt' }, { case: { $isNumber: '$$b' }, then: '$$b' }, { case: { $regexMatch: { input: { $toString: '$$b' }, regex: /^\d+(\.\d+)?$/ } }, then: { $toDouble: '$$b' } } ], default: null } } } };
  }

  const stages = [];
  if (coarseYmd) stages.push({ $match: { booking_date: coarseYmd } });
  stages.push({ $set: baseSet });
  if (needBookingDt) {
    stages.push({ $set: { booking_dt: {
      $let: {
        vars: {
          dayDate: { $cond: [ { $and: [ { $ne: ['$booking_date_n', null] }, { $ne: ['$booking_date_n', ''] } ] }, { $dateFromString: { dateString: '$booking_date_n', format: '%Y-%m-%d', timezone: DASHBOARD_TZ, onError: null, onNull: null } }, null ] },
          isoDate: { $cond: [ { $eq: [ { $type: '$booking_date_iso' }, 'date' ] }, '$booking_date_iso', { $convert: { input: { $trim: { input: { $toString: { $ifNull: ['$booking_date_iso', ''] } } } }, to: 'date', onError: null, onNull: null } } ] },
          bookedAtDate: { $cond: [ { $eq: [ { $type: '$booked_at' }, 'date' ] }, '$booked_at', { $convert: { input: { $trim: { input: { $toString: { $ifNull: ['$booked_at', ''] } } } }, to: 'date', onError: null, onNull: null } } ] },
        },
        in: {
          $first: {
            $filter: {
              input: ['$$dayDate', '$$isoDate', '$$bookedAtDate'],
              as: 'c',
              cond: { $ne: ['$$c', null] }
            }
          }
        }
      }
    } } });
  }
  const aliasSet = {};
  if (needBooking || needBookingDt) aliasSet.booking_date = '$booking_date_n';
  if (needBond) aliasSet.bond_amount = '$bond_amount_n';
  if (Object.keys(aliasSet).length) stages.push({ $set: aliasSet });
  stages.push({ $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', BASE_COLLECTION.replace(/^simple_/, '')] } } } } } });
  stages.push({ $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } });
  if (coarseYmd) stages.push({ $match: { booking_date_n: coarseYmd } });
  const rewrittenMatch = match ? rewriteBookingKeys(match) : {};
  stages.push({ $match: rewrittenMatch });
  if (project) stages.push({ $project: project });

  const collCounty = (name) => (name || '').replace(/^simple_/, '') || 'unknown';
  const unionPipelines = COUNTY_COLLECTIONS.slice(1).map((coll) => ({
    $unionWith: {
      coll,
      pipeline: (() => {
        const up = [];
        if (coarseYmd) up.push({ $match: { booking_date: coarseYmd } });
        up.push({ $set: baseSet }); // reuse logic (acceptable slight duplication)
        if (needBookingDt) up.push({ $set: { booking_dt: {
          $let: {
            vars: {
              dayDate: { $cond: [ { $and: [ { $ne: ['$booking_date_n', null] }, { $ne: ['$booking_date_n', ''] } ] }, { $dateFromString: { dateString: '$booking_date_n', format: '%Y-%m-%d', timezone: DASHBOARD_TZ, onError: null, onNull: null } }, null ] },
              isoDate: { $cond: [ { $eq: [ { $type: '$booking_date_iso' }, 'date' ] }, '$booking_date_iso', { $convert: { input: { $trim: { input: { $toString: { $ifNull: ['$booking_date_iso', ''] } } } }, to: 'date', onError: null, onNull: null } } ] },
              bookedAtDate: { $cond: [ { $eq: [ { $type: '$booked_at' }, 'date' ] }, '$booked_at', { $convert: { input: { $trim: { input: { $toString: { $ifNull: ['$booked_at', ''] } } } }, to: 'date', onError: null, onNull: null } } ] },
            },
            in: {
              $first: {
                $filter: {
                  input: ['$$dayDate', '$$isoDate', '$$bookedAtDate'],
                  as: 'c',
                  cond: { $ne: ['$$c', null] }
                }
              }
            }
          }
        } } });
        if (Object.keys(aliasSet).length) up.push({ $set: aliasSet });
        up.push({ $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', collCounty(coll)] } } } } } });
        up.push({ $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } });
        if (coarseYmd) up.push({ $match: { booking_date_n: coarseYmd } });
        up.push({ $match: rewrittenMatch });
        if (project) up.push({ $project: project });
        return up;
      })()
    }
  }));

  return stages.concat(unionPipelines);
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
  scraped_at: 1,
  time_bucket: 1,
  scraped_at_dt: 1,
        booking_dt: 1,
  normalized_at_dt: 1,
};

// Per-file DB timeout for potentially expensive aggregations (env overridable)
const MAX_DB_MS = parseInt(process.env.DASH_MAX_DB_MS || process.env.MAX_DB_MS || '12000', 10);

// Helper to timeout a promise-returning DB operation so endpoints don't hang
function withTimeout(promise, ms = MAX_DB_MS, label = 'db op') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => {
        // Soft diagnostic to explain occasional zeroed KPIs when a cold aggregation takes a bit longer
        console.warn(`[dashboard] ${label} timed out after ${ms}ms`);
        rej(new Error('operation timed out'));
      }, ms);
    })
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
    const docs = await withTimeout(cursor.toArray(), MAX_DB_MS, 'fetchContactedCaseIds.toArray').catch(() => []);
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
const dayShift = (n) => ymdInTZ(new Date(Date.now() - n * 86400000));
const rangeDayStrs = (n) => Array.from({ length: n }, (_, i) => dayShift(i));

async function countByMatch(db, match) {
  if (!match || (typeof match === 'object' && !Object.keys(match).length)) return 0;
  // Derive needs from the match shape: if it references time_bucket_n or booking_date
  const s = JSON.stringify(match);
  const needsBooking = s.includes('booking_date');
  const needsBookingDt = s.includes('booking_dt');
  const needsBucket  = false;
  const pipeline = [...unionAllFast(match, { _id: 1 }, { needBooking: needsBooking, needBookingDt: needsBookingDt, needTimeBucket: needsBucket }), { $count: 'n' }];
  const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
    const doc = await withTimeout(cursor.next(), MAX_DB_MS, 'countByMatch.next').catch(() => null);
  return doc ? doc.n : 0;
}

async function countByWindow(db, win) {
  return countByMatch(db, buildWindowMatch(win));
}

async function sumBondForWindow(db, win) {
  const match = buildWindowMatch(win);
  if (!match || (typeof match === 'object' && !Object.keys(match).length)) return 0;
  const s = JSON.stringify(match);
  const needsBooking = s.includes('booking_date');
  const needsBookingDt = s.includes('booking_dt');
  const needsBucket  = false;
  const pipeline = [
    ...unionAllFast(match, { bond_amount: 1 }, { needBond: true, needBooking: needsBooking, needBookingDt: needsBookingDt, needTimeBucket: needsBucket }),
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ['$bond_amount', 0] } },
      },
    },
    { $project: { _id: 0, total: 1 } },
  ];
  const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
    const doc = await withTimeout(cursor.next(), MAX_DB_MS, 'sumBondForWindow.next').catch(() => null);
  return doc ? doc.total : 0;
}

async function bondByCountyForWindow(db, win) {
  const match = buildWindowMatch(win);
  if (!match || (typeof match === 'object' && !Object.keys(match).length)) return [];
  const s = JSON.stringify(match);
  const needsBooking = s.includes('booking_date');
  const needsBookingDt = s.includes('booking_dt');
  const needsBucket  = false;
  const agg = baseColl(db).aggregate([
    ...unionAllFast(match, { county: 1, bond_amount: 1 }, { needBond: true, needBooking: needsBooking, needBookingDt: needsBookingDt, needTimeBucket: needsBucket }),
    { $group: { _id: '$county', value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
    { $project: { _id: 0, county: '$_id', value: 1 } },
    { $sort: { county: 1 } },
  ], { allowDiskUse: true });
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
    return withTimeout(cursor.toArray(), MAX_DB_MS, 'bondByCountyForWindow.toArray').catch(() => []);
}

async function adaptiveBondByCounty(db, preferred = ['24h', '48h', '72h', '7d']) {
  const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
  const results = new Map();
  for (const win of preferred) {
    const rows = await bondByCountyForWindow(db, win).catch(() => []);
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
  const key = 'kpis:v1';
  const { fromCache, data } = await withCache(key, async () => {
    const [c24, c48, c72, c7, c30] = await Promise.all([
      countByWindow(db, '24h'),
      countByWindow(db, '48h'),
      countByWindow(db, '72h'),
      countByWindow(db, '7d'),
      countByWindow(db, '30d'),
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
      perCountyLastPull = await withTimeout((aggJob.maxTimeMS ? aggJob.maxTimeMS(MAX_DB_MS) : aggJob).toArray(), MAX_DB_MS, 'kpis.perCountyLastPull').catch(() => []);
    } catch { /* optional */ }

    // Fallback: compute last data timestamp per county from collections themselves
    let perCountyLastData = [];
    try {
      const aggData = baseColl(db).aggregate([
        ...unionAll({}, { county: 1, scraped_at_dt: 1, normalized_at_dt: 1 }),
        { $group: { _id: '$county', lastData: { $max: { $ifNull: ['$scraped_at_dt', '$normalized_at_dt'] } } } },
        { $project: { _id: 0, county: '$_id', lastData: 1 } },
        { $sort: { county: 1 } }
      ], { allowDiskUse: true });
      perCountyLastData = await withTimeout((aggData.maxTimeMS ? aggData.maxTimeMS(MAX_DB_MS) : aggData).toArray(), MAX_DB_MS, 'kpis.perCountyLastData').catch(() => []);
    } catch { /* best-effort */ }

    let contacted24h = { contacted: 0, total: c24, rate: 0 };
    try {
      const aggTodayIds = baseColl(db).aggregate([
        ...unionAll(buildWindowMatch('24h'), { _id: 1 }),
      ], { allowDiskUse: true });
      const todayDocs = await withTimeout((aggTodayIds.maxTimeMS ? aggTodayIds.maxTimeMS(MAX_DB_MS) : aggTodayIds).toArray(), MAX_DB_MS, 'kpis.todayDocs').catch(() => []);
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

    return {
      newCountsBooked: { today: c24, yesterday: c48, twoDaysAgo: c72, last7d: c7, last30d: c30 },
      perCountyBond,
      bondTotal,
      perCountyBondToday: perCountyBond.map(({ county, value }) => ({ county, value })),
      bondTodayTotal: bondTotal,
      perCountyLastPull,
      perCountyLastData,
      contacted24h,
      windowsUsed: ['24h','48h','72h','7d','30d'],
    };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.json(data);
});

// ===== TOP (by bond value, booking window) =====
r.get('/top', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const requestedWindow = String(req.query.window || '24h').toLowerCase();
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  let windowUsed = requestedWindow;
  const cacheKey = `top:v1:${requestedWindow}:${limit}:${countyFilter ? countyFilter.county : 'all'}:${req.query.attention === '1' || req.query.attention === 'true'}`;

  const basePipeline = (matchExpr) => ([
    ...unionAll(matchExpr, P),
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
        time_bucket: 1,
        normalized_at: 1,
        scraped_at: 1,
      }}
  ]);

  const { fromCache, data } = await withCache(cacheKey, async () => {
    const aggItemsTop = baseColl(db).aggregate(basePipeline(buildWindowMatch(requestedWindow)));
    let items = await withTimeout((aggItemsTop.maxTimeMS ? aggItemsTop.maxTimeMS(MAX_DB_MS) : aggItemsTop).toArray(), MAX_DB_MS).catch(() => []);
    if (requestedWindow === '24h' && items.length === 0) {
      const agg2 = baseColl(db).aggregate(basePipeline(buildWindowMatch('48h')));
      items = await withTimeout((agg2.maxTimeMS ? agg2.maxTimeMS(MAX_DB_MS) : agg2).toArray(), MAX_DB_MS).catch(() => []);
      if (items.length) windowUsed = '48h';
    }
    if (items.length) {
      const meta = await fetchContactedCaseIds(items.map((it) => it.id));
      items = items.map((item) => ({
        ...item,
        contacted: meta.contactSet.has(String(item.id)),
        last_contact_at: meta.lastMap.get(String(item.id)) || null,
        windowUsed,
      }));
    }
    return items;
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.json(data);
});

// ===== NEW (today) =====
r.get('/new', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);

  const cacheKey = `new:v1:${limit}:${countyFilter ? countyFilter.county : 'all'}:${req.query.attention === '1' || req.query.attention === 'true'}`;
  const { fromCache, data } = await withCache(cacheKey, async () => {
  const aggItemsNew = baseColl(db).aggregate([
  ...unionAll(buildWindowMatch('24h'), P),
    ...attentionStages(req.query.attention === '1' || req.query.attention === 'true'),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
  { $sort: { booking_dt: -1, booking_date: -1, bond_amount: -1 } },
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
        time_bucket: 1,
        normalized_at: 1,
        scraped_at: 1,
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
    ...unionAll(buildWindowMatch('24h'), { county: 1 }),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
    { $group: { _id: '$county', n: { $sum: 1 } } },
    { $project: { _id: 0, county: '$_id', n: 1 } },
    { $sort: { county: 1 } }
  ]);
    const ticker = await withTimeout((aggTicker.maxTimeMS ? aggTicker.maxTimeMS(MAX_DB_MS) : aggTicker).toArray(), MAX_DB_MS).catch(() => []);
    return { items, ticker, summary, windowUsed: '24h' };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.json(data);
});

// ===== RECENT (48–72h window) =====
r.get('/recent', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const cacheKey = `recent:v1:${limit}:${req.query.attention === '1' || req.query.attention === 'true'}`;
  const { fromCache, data } = await withCache(cacheKey, async () => {
    const [count48h, count72h, bond48h, bond72h] = await Promise.all([
      countByWindow(db, '48h'),
      countByWindow(db, '72h'),
      sumBondForWindow(db, '48h'),
      sumBondForWindow(db, '72h'),
    ]);

  const match48 = buildWindowMatch('48h');
  const match72 = buildWindowMatch('72h');
  const recentMatchOr = [match48, match72].filter((m) => m && Object.keys(m).length);
  const recentMatch = recentMatchOr.length ? { $or: recentMatchOr } : {};

  const aggItemsRecent = baseColl(db).aggregate([
    ...unionAll(recentMatch, P),
    ...attentionStages(req.query.attention === '1' || req.query.attention === 'true'),
  { $sort: { booking_dt: -1, booking_date: -1, bond_amount: -1 } },
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
        time_bucket: 1,
        normalized_at: 1,
        scraped_at: 1,
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

    const ticker = await (async () => {
      const aggT = baseColl(db).aggregate([
        ...unionAll(recentMatch, { county: 1 }),
        { $group: { _id: '$county', n: { $sum: 1 } } },
        { $project: { _id: 0, county: '$_id', n: 1 } },
        { $sort: { county: 1 } }
      ]);
      return await withTimeout((aggT.maxTimeMS ? aggT.maxTimeMS(MAX_DB_MS) : aggT).toArray(), MAX_DB_MS).catch(() => []);
    })();

    return {
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
      ticker,
      windowUsed: ['48h','72h'],
    };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.json(data);
});

// ===== TRENDS (last N calendar days) =====
r.get('/trends', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 60);
  const dates = rangeDayStrs(days); // oldest-first
  const cacheKey = `trends:v1:${days}`;
  const { fromCache, data } = await withCache(cacheKey, async () => {
    const agg = baseColl(db).aggregate([
      ...unionAllFast({ booking_date: { $in: dates } }, { county: 1, booking_date: 1, bond_amount: 1 }, { needBooking: true, needBond: true }),
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

    return {
      days,
      dates: dates.slice().reverse(),
      rows: filled.sort((a, b) =>
        a.date > b.date ? 1 : a.date < b.date ? -1 : a.county.localeCompare(b.county)
      )
    };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.json(data);
});

// ===== PER-COUNTY snapshot =====
r.get('/per-county', async (req, res) => {
  try {
    const db = ensureDb(res); if (!db) return;
    const win = (req.query.window || '24h').toLowerCase();
    const cacheKey = `perCounty:v2:${win}`;
    const { fromCache, data } = await withCache(cacheKey, async () => {
      // Coarse lower bound: last 30 days covers all required buckets
      const since30 = new Date(Date.now() - 30 * 24 * 3600000);
      const match = { booking_dt: { $gte: since30 } };

      // Build window predicate for bondValue based on 'win'
      const winCond = (() => {
        const and = (...conds) => ({ $and: conds });
        const lt = (f, n) => ({ $lt: [f, n] });
        const gte = (f, n) => ({ $gte: [f, n] });
        const h = '$hoursAgo';
        switch (win) {
          case '24h': return lt(h, 24);
          case '48h': return and(gte(h, 24), lt(h, 48));
          case '72h': return and(gte(h, 48), lt(h, 72));
          case '7d':  return lt(h, 24 * 7);
          case '30d': return lt(h, 24 * 30);
          default:    return lt(h, 24);
        }
      })();

      const pipeline = [
        ...unionAllFast(match, { county: 1, bond_amount: 1, booking_dt: 1 }, { needBond: true, needBookingDt: true }),
        // Compute age in hours using booking_dt vs $$NOW
        { $set: { hoursAgo: { $dateDiff: { startDate: '$booking_dt', endDate: '$$NOW', unit: 'hour' } } } },
        {
          $group: {
            _id: '$county',
            today:      { $sum: { $cond: [{ $lt: ['$hoursAgo', 24] }, 1, 0] } },
            yesterday:  { $sum: { $cond: [{ $and: [{ $gte: ['$hoursAgo', 24] }, { $lt: ['$hoursAgo', 48] }] }, 1, 0] } },
            twoDaysAgo: { $sum: { $cond: [{ $and: [{ $gte: ['$hoursAgo', 48] }, { $lt: ['$hoursAgo', 72] }] }, 1, 0] } },
            last7d:     { $sum: { $cond: [{ $lt: ['$hoursAgo', 24 * 7] }, 1, 0] } },
            last30d:    { $sum: { $cond: [{ $lt: ['$hoursAgo', 24 * 30] }, 1, 0] } },
            bondToday:  { $sum: { $cond: [{ $lt: ['$hoursAgo', 24] }, { $ifNull: ['$bond_amount', 0] }, 0] } },
            bondWindow: { $sum: { $cond: [winCond, { $ifNull: ['$bond_amount', 0] }, 0] } },
          }
        },
        { $project: { _id: 0, county: '$_id', counts: { today: '$today', yesterday: '$yesterday', twoDaysAgo: '$twoDaysAgo', last7d: '$last7d', last30d: '$last30d' }, bondValue: '$bondWindow', bondToday: 1 } },
        { $sort: { county: 1 } },
      ];

      const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
      const rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);

      // Ensure all counties are present
      const counties = COUNTY_COLLECTIONS.map((c) => c.replace('simple_', ''));
      const map = new Map(rows.map((r) => [String(r.county || '').toLowerCase(), r]));
      const items = counties.map((cty) => (
        map.get(cty) || { county: cty, counts: { today: 0, yesterday: 0, twoDaysAgo: 0, last7d: 0, last30d: 0 }, bondValue: 0, bondToday: 0 }
      ));

      return { items, windowUsed: win };
    });
    res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
    res.json(data);
  } catch (err) {
    console.error('per-county error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// ===== DIAGNOSTICS (window bounds + sample) =====
r.get('/diag', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const win = (req.query.window || '24h').toLowerCase();
  const rawMode = req.query.raw === '1' || req.query.raw === 'true';
  const match = rawMode ? {} : buildWindowMatch(win);

  // Extract booking_dt range (our buildWindowMatch returns {$and:[ {...}, ... ]})
  let since = null; let until = null;
  const extract = (cond) => {
    if (!cond || typeof cond !== 'object') return;
    if (cond.booking_dt && typeof cond.booking_dt === 'object') {
      if (cond.booking_dt.$gte instanceof Date) since = cond.booking_dt.$gte;
      if (cond.booking_dt.$lt instanceof Date) until = cond.booking_dt.$lt;
    }
  };
  if (Array.isArray(match.$and)) match.$and.forEach(extract); else extract(match);

  // Additional diagnostics when raw mode: show booking_dt null vs non-null for recent two days
  const now = new Date();
  const since48 = new Date(now.getTime() - 48 * 3600000);
  const pipeline = [
    ...unionAllFast(match, { county: 1, booking_dt: 1, bond_amount: 1, booking_date: 1 }, { needBookingDt: true, needBond: true }),
    { $facet: Object.assign({
      sample: [ { $sort: { booking_dt: -1 } }, { $limit: 5 }, { $project: { _id: 0, county: 1, booking_dt: 1, bond_amount: 1, booking_date: 1 } } ],
      stats: [ { $group: { _id: null, count: { $sum: 1 }, bondSum: { $sum: { $ifNull: ['$bond_amount', 0] } } } } ]
    }, rawMode ? {
      recentBookingDtAudit: [
        { $match: { booking_date: { $gte: ymdInTZ(since48) } } },
        { $group: { _id: { hasBookingDt: { $ne: ['$booking_dt', null] } }, n: { $sum: 1 } } },
        { $project: { _id: 0, hasBookingDt: '$_id.hasBookingDt', n: 1 } }
      ],
      recentLatest: [
        { $match: { booking_date: { $gte: ymdInTZ(since48) } } },
        { $sort: { booking_dt: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, county: 1, booking_date: 1, booking_dt: 1, bond_amount: 1 } }
      ]
    } : {}) }
  ];
  let count = 0; let bondSum = 0; let sample = []; let recentAudit = []; let recentLatest = [];
  try {
    const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
    const doc = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).next(), MAX_DB_MS, 'diag.facet').catch(() => null);
    if (doc) {
      sample = doc.sample || [];
      if (Array.isArray(doc.stats) && doc.stats.length) {
        count = doc.stats[0].count || 0;
        bondSum = doc.stats[0].bondSum || 0;
      }
      if (rawMode) {
        recentAudit = doc.recentBookingDtAudit || [];
        recentLatest = doc.recentLatest || [];
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'diag failed', message: e?.message });
  }
  res.set('X-Perf-Window', win);
  res.json({ window: win, windowUsed: win, rawMode, since, until, match, count, bondSum, sample, recentAudit, recentLatest });
});

export default r;
