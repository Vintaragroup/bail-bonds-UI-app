/* eslint-env node */
/* global process */
// server/src/routes/dashboard.js
import { Router } from 'express';
import { bucketsForWindow, legacyWindowForBucket, V2_BUCKET_ORDER } from '../lib/buckets.js';
import { userHasPermission } from '../lib/roles.js';
import mongoose from 'mongoose';
import Message from '../models/Message.js';   // optional
import Job from '../models/Job.js';           // optional

const r = Router();

function assertPermission(req, permission) {
  if (!req.user || !userHasPermission(req.user.roles, permission)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

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

// ===== Simple in-memory metrics =====
const DASH_METRICS = { routes: new Map() }; // routeKey -> {count, errors, durations[], lastError, variants:Map}
function recordMetric(routeKey, ms, status, variant, err) {
  let r = DASH_METRICS.routes.get(routeKey);
  if (!r) { r = { count:0, errors:0, durations:[], lastError:null, variants:new Map() }; DASH_METRICS.routes.set(routeKey, r); }
  r.count += 1;
  if (err || status >= 500) { r.errors += 1; r.lastError = String(err?.message || err || status); }
  r.durations.push(ms); if (r.durations.length > 300) r.durations.splice(0, r.durations.length - 300);
  if (variant) r.variants.set(variant, (r.variants.get(variant) || 0) + 1);
}
function withMetrics(routeKey, handler) {
  return async (req, res) => {
    const start = process.hrtime.bigint();
    let variantRef = null;
    const origSet = res.set.bind(res);
    res.set = (field, val) => {
      if (typeof field === 'string') {
        if (/variant/i.test(field)) variantRef = val;
      } else if (field && typeof field === 'object') {
        for (const k of Object.keys(field)) if (/variant/i.test(k)) variantRef = field[k];
      }
      return origSet(field, val);
    };
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) });
      const end = process.hrtime.bigint();
      recordMetric(routeKey, Number(end - start)/1e6, res.statusCode || 500, variantRef, err);
      return;
    }
    const end = process.hrtime.bigint();
    recordMetric(routeKey, Number(end - start)/1e6, res.statusCode || 200, variantRef, null);
  };
}

r.get('/metrics', (req, res) => {
  const out = [];
  for (const [k,v] of DASH_METRICS.routes.entries()) {
    const d = v.durations.slice().sort((a,b)=>a-b);
    const pct = (p) => d.length ? d[Math.min(d.length-1, Math.floor(p/100*(d.length-1)))] : 0;
    out.push({
      route: k,
      count: v.count,
      errors: v.errors,
      errorRate: v.count ? +(v.errors/v.count).toFixed(4) : 0,
      p50: pct(50), p90: pct(90), p95: pct(95), p99: pct(99),
      variants: Array.from(v.variants.entries()).map(([variant,n]) => ({ variant, n })),
      lastError: v.lastError,
    });
  }
  res.json({ generatedAt: new Date().toISOString(), routes: out });
});

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
// Legacy calendar (pre-contract) window matching (retained as fallback)
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

// New v2 bucket-based window match using time_bucket_v2 taxonomy.
// Windows 24h/48h/72h map to single buckets. 7d/30d are bucket unions.
const buildWindowMatchV2 = (win) => {
  const w = (win || '').toLowerCase();
  // Buckets for discrete windows – direct equality.
  switch (w) {
    case '24h': return { time_bucket_v2: '0_24h' };
    case '48h': return { time_bucket_v2: '24_48h' };
    case '72h': return { time_bucket_v2: '48_72h' };
    case '7d':  return { time_bucket_v2: { $in: ['0_24h','24_48h','48_72h','3d_7d'] } };
    case '30d': return { time_bucket_v2: { $in: ['0_24h','24_48h','48_72h','3d_7d','7d_30d'] } };
    default:    return { time_bucket_v2: '0_24h' };
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

// Extremely lightweight union focused on time_bucket_v2 equality / IN queries.
// Assumptions (validated by caller):
//  - Only filters on time_bucket_v2 and category exclusion already implicit.
//  - Need only _id and time_bucket_v2 (optionally county) for counts.
//  - time_bucket_v2 already materialized & indexed.
function unionBucketsFast(bucketMatch = {}, project = null, { needCounty = false, needBond = false } = {}) {
  const baseProject = project || { _id: 1, time_bucket_v2: 1, ...(needCounty ? { county: 1 } : {}), ...(needBond ? { bond_amount: 1, bond: 1, bond_label: 1 } : {}) };
  const bondSetStage = needBond ? [{
    $set: {
      bond_amount: {
        $let: { vars: { bAmt: '$bond_amount', b: '$bond' }, in: { $switch: { branches: [ { case: { $ne: ['$$bAmt', null] }, then: '$$bAmt' }, { case: { $isNumber: '$$b' }, then: '$$b' }, { case: { $regexMatch: { input: { $toString: '$$b' }, regex: /^\d+(\.\d+)?$/ } }, then: { $toDouble: '$$b' } } ], default: null } } }
      }
    }
  }] : [];
  const base = [
    { $match: bucketMatch },
    ...(needCounty ? [{ $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', BASE_COLLECTION.replace(/^simple_/, '')] } } } } } }] : []),
    // Exclude Harris Civil AFTER normalization (parity with unionAll)
    { $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } },
    ...bondSetStage,
    { $project: baseProject }
  ];
  const unions = COUNTY_COLLECTIONS.slice(1).map(coll => ({
    $unionWith: {
      coll,
      pipeline: [
        { $match: bucketMatch },
        ...(needCounty ? [{ $set: { county: { $toLower: { $trim: { input: { $ifNull: ['$county', coll.replace(/^simple_/, '')] } } } } } }] : []),
        { $match: { $nor: [ { county: 'harris', category: 'Civil' } ] } },
        ...bondSetStage,
        { $project: baseProject }
      ]
    }
  }));
  return base.concat(unions);
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

async function countByWindow(db, win, useV2 = false) {
  return countByMatch(db, useV2 ? buildWindowMatchV2(win) : buildWindowMatch(win));
}

// Fast path: get counts for all primary KPI windows in a single aggregation when in v2 bucket mode.
// Returns map: { '0_24h': n, '24_48h': n, ... }
async function computeBucketCounts(db) {
  // Single pass grouping by time_bucket_v2
  const pipeline = [
    ...unionBucketsFast({}, { time_bucket_v2: 1 }),
    { $group: { _id: '$time_bucket_v2', n: { $sum: 1 } } },
    { $project: { _id: 0, bucket: '$_id', n: 1 } }
  ];
  const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
  const docs = await withTimeout(cursor.toArray(), MAX_DB_MS, 'computeBucketCounts.toArray').catch(() => []);
  const out = new Map();
  docs.forEach(d => { if (d?.bucket) out.set(d.bucket, d.n || 0); });
  return out;
}

async function sumBondForWindow(db, win, useV2 = false) {
  const match = useV2 ? buildWindowMatchV2(win) : buildWindowMatch(win);
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

async function bondByCountyForWindow(db, win, useV2 = false) {
  const match = useV2 ? buildWindowMatchV2(win) : buildWindowMatch(win);
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

// Single pass per-county adaptive bond totals using v2 buckets fast path.
// Logic:
//  - Aggregate sums per county per bucket.
//  - For each county choose earliest window with non-zero sum across 24h,48h,72h,7d analogs.
async function adaptiveBondByCountyV2SinglePass(db, preferred = ['24h','48h','72h','7d']) {
  const bucketToWindow = (bucket) => {
    switch (bucket) {
      case '0_24h': return '24h';
      case '24_48h': return '48h';
      case '48_72h': return '72h';
      case '3d_7d': return '7d';
      default: return null;
    }
  };
  const pipeline = [
    ...unionBucketsFast({}, { county: 1, time_bucket_v2: 1, bond_amount: 1 }, { needCounty: true, needBond: true }),
    { $match: { time_bucket_v2: { $in: ['0_24h','24_48h','48_72h','3d_7d'] } } },
    { $group: { _id: { county: '$county', bucket: '$time_bucket_v2' }, value: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
    { $project: { _id: 0, county: '$_id.county', bucket: '$_id.bucket', value: 1 } }
  ];
  const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
  const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
  const docs = await withTimeout(cursor.toArray(), MAX_DB_MS, 'adaptiveBondByCountyV2SinglePass.toArray').catch(() => []);
  const byCounty = new Map();
  docs.forEach(d => {
    if (!d?.county) return;
    if (!byCounty.has(d.county)) byCounty.set(d.county, new Map());
    byCounty.get(d.county).set(bucketToWindow(d.bucket), d.value || 0);
  });
  const counties = COUNTY_COLLECTIONS.map(c => c.replace('simple_', ''));
  const out = [];
  for (const county of counties) {
    const winMap = byCounty.get(county) || new Map();
    let used = preferred[preferred.length - 1];
    let value = 0;
    for (const win of preferred) {
      const v = winMap.get(win) || 0;
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
r.get('/kpis', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
  const variant = useV2 ? 'buckets-fast' : 'legacy';
  const key = `kpis:v2:${variant}`;
  const { fromCache, data } = await withCache(key, async () => {
    let c24, c48, c72, c7, c30;
    let pathVariantUsed = variant;
    if (useV2) {
      try {
        const t0 = Date.now();
        const bucketCounts = await computeBucketCounts(db);
        res.locals.perfMark && res.locals.perfMark('kpisBuckets');
        // Map windows using canonical union semantics
        const bc = (b) => bucketCounts.get(b) || 0;
        c24 = bc('0_24h');
        c48 = bc('24_48h');
        c72 = bc('48_72h');
        c7  = bc('0_24h') + bc('24_48h') + bc('48_72h') + bc('3d_7d');
        c30 = c7 + bc('7d_30d');
        const t1 = Date.now();
        res.locals.perfMark && res.locals.perfMark(`kpisBucketsDone`);
      } catch (e) {
        // Fallback to legacy per-window counting preserving semantics
        pathVariantUsed = 'fallback-countByWindow';
        [c24, c48, c72, c7, c30] = await Promise.all([
          countByWindow(db, '24h', useV2),
          countByWindow(db, '48h', useV2),
          countByWindow(db, '72h', useV2),
          countByWindow(db, '7d',  useV2),
          countByWindow(db, '30d', useV2),
        ]);
      }
    } else {
      [c24, c48, c72, c7, c30] = await Promise.all([
        countByWindow(db, '24h', useV2),
        countByWindow(db, '48h', useV2),
        countByWindow(db, '72h', useV2),
        countByWindow(db, '7d',  useV2),
        countByWindow(db, '30d', useV2),
      ]);
    }
    let perCountyBond;
    if (useV2) {
      try {
        perCountyBond = await adaptiveBondByCountyV2SinglePass(db, ['24h','48h','72h','7d']);
        res.locals.perfMark && res.locals.perfMark('kpisBondAdaptive');
      } catch {
        perCountyBond = await adaptiveBondByCounty(db, ['24h','48h','72h','7d']);
        res.locals.perfMark && res.locals.perfMark('kpisBondAdaptiveFallback');
      }
    } else {
      perCountyBond = await adaptiveBondByCounty(db, ['24h','48h','72h','7d']);
    }
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
      const aggTodayIds = baseColl(db).aggregate(useV2 ? [
        ...unionBucketsFast({ time_bucket_v2: '0_24h' }, { _id: 1 })
      ] : [
        ...unionAll(buildWindowMatch('24h'), { _id: 1 })
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
      mode: useV2 ? 'v2_buckets' : 'legacy',
      pathVariant: pathVariantUsed || variant
    };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  if (data?.pathVariant) res.set('X-Path-Variant', data.pathVariant);
  res.json(data);
});

// ===== TOP (by bond value, booking window) =====
r.get('/top', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const requestedWindow = String(req.query.window || '24h').toLowerCase();
  const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  let windowUsed = requestedWindow;
  const attentionOnly = req.query.attention === '1' || req.query.attention === 'true';
  const cacheKey = `top:v2:${requestedWindow}:${limit}:${countyFilter ? countyFilter.county : 'all'}:${attentionOnly}:${useV2}`;

  const basePipeline = (matchExpr) => ([
    ...unionAll(matchExpr, { ...P, booking_datetime: 1, time_bucket_v2: 1, booking_derivation_source: 1 }),
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
        time_bucket_v2: 1,
        booking_datetime: 1,
        booking_derivation_source: 1,
        normalized_at: 1,
        scraped_at: 1,
      }}
  ]);

  const { fromCache, data } = await withCache(cacheKey, async () => {
    let variant = 'legacy';
    if (!useV2) {
      // legacy path unchanged
      const matchPrimary = buildWindowMatch(requestedWindow);
      const aggItemsTop = baseColl(db).aggregate(basePipeline(matchPrimary));
      let items = await withTimeout((aggItemsTop.maxTimeMS ? aggItemsTop.maxTimeMS(MAX_DB_MS) : aggItemsTop).toArray(), MAX_DB_MS).catch(() => []);
      if (requestedWindow === '24h' && items.length === 0) {
        const fallbackMatch = buildWindowMatch('48h');
        const agg2 = baseColl(db).aggregate(basePipeline(fallbackMatch));
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
          mapped_window: windowUsed,
        }));
      }
      return { items, mode: 'legacy', pathVariant: variant };
    }

    // v2 fast path for single-bucket windows (24h/48h/72h). 7d/30d keep legacy heavy pipeline.
    const singleBucketMap = { '24h': '0_24h', '48h': '24_48h', '72h': '48_72h' };
    const bucket = singleBucketMap[requestedWindow];
    if (!bucket) {
      // reuse existing heavy path for broader windows
      variant = 'v2-heavy';
      const matchPrimary = buildWindowMatchV2(requestedWindow);
      const aggItemsTop = baseColl(db).aggregate(basePipeline(matchPrimary));
      let items = await withTimeout((aggItemsTop.maxTimeMS ? aggItemsTop.maxTimeMS(MAX_DB_MS) : aggItemsTop).toArray(), MAX_DB_MS).catch(() => []);
      if (requestedWindow === '24h' && items.length === 0) {
        const fallbackMatch = buildWindowMatchV2('48h');
        const agg2 = baseColl(db).aggregate(basePipeline(fallbackMatch));
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
          mapped_window: item.time_bucket_v2 === '0_24h' ? '24h' : item.time_bucket_v2 === '24_48h' ? '48h' : item.time_bucket_v2 === '48_72h' ? '72h' : null,
        }));
      }
      return { items, mode: 'v2_buckets', pathVariant: variant };
    }

    // Fast path: lean projection & bond sort using unionBucketsFast
    variant = 'v2-buckets-fast-top';
    const bucketMatch = { time_bucket_v2: bucket };
    const fastPipeline = [
      ...unionBucketsFast(bucketMatch, { _id: 1, time_bucket_v2: 1, county: 1, bond_amount: 1, bond: 1, bond_label: 1, full_name: 1, charge: 1, category: 1, agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1 }, { needCounty: true, needBond: true }),
      ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
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
          time_bucket_v2: 1,
        } }
    ];
    let items = await withTimeout((baseColl(db).aggregate(fastPipeline).maxTimeMS?.(MAX_DB_MS) ?? baseColl(db).aggregate(fastPipeline)).toArray(), MAX_DB_MS).catch(() => []);
    // Fallback to heavy path if empty and 24h requested (same semantics as before)
    if (requestedWindow === '24h' && items.length === 0) {
      variant = 'v2-buckets-fast-top-fallback48h';
      const fbPipeline = [
        ...unionBucketsFast({ time_bucket_v2: '24_48h' }, { _id: 1, time_bucket_v2: 1, county: 1, bond_amount: 1, bond: 1, bond_label: 1, full_name: 1, charge: 1, category: 1, agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1 }, { needCounty: true, needBond: true }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        ...(countyFilter ? [{ $match: countyFilter }] : []),
        { $set: { sortValue: { $cond: [ { $isNumber: '$bond_amount' }, '$bond_amount', { $toDouble: { $ifNull: ['$bond', 0] } } ] } } },
        { $sort: { sortValue: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, name: '$full_name', county: 1, category: 1, bond_amount: 1, value: '$sortValue', offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, needs_attention: 1, attention_reasons: 1, time_bucket_v2: 1 } }
      ];
      items = await withTimeout((baseColl(db).aggregate(fbPipeline).maxTimeMS?.(MAX_DB_MS) ?? baseColl(db).aggregate(fbPipeline)).toArray(), MAX_DB_MS).catch(() => []);
      if (items.length) windowUsed = '48h';
    }
    if (items.length) {
      const meta = await fetchContactedCaseIds(items.map(i => i.id));
      items = items.map(item => ({
        ...item,
        contacted: meta.contactSet.has(String(item.id)),
        last_contact_at: meta.lastMap.get(String(item.id)) || null,
        windowUsed,
        mapped_window: item.time_bucket_v2 === '0_24h' ? '24h' : item.time_bucket_v2 === '24_48h' ? '48h' : item.time_bucket_v2 === '48_72h' ? '72h' : null,
      }));
    }
    return { items, mode: 'v2_buckets', pathVariant: variant };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  if (data?.pathVariant) res.set('X-Top-Variant', data.pathVariant);
  res.json(data);
});

// ===== NEW (today) =====
r.get('/new', withMetrics('new', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
  const countyFilter = req.query.county ? { county: req.query.county } : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const attentionOnly = req.query.attention === '1' || req.query.attention === 'true';
  const cacheKey = `new:v2:${limit}:${countyFilter ? countyFilter.county : 'all'}:${attentionOnly}:${useV2}`;
  const { fromCache, data } = await withCache(cacheKey, async () => {
    let variant = useV2 ? 'v2-buckets-fast-new' : 'legacy';
    let pipeline;
    if (useV2) {
      // Fast path: single bucket 0_24h, minimal projection & needed fields
      pipeline = [
        ...unionBucketsFast({ time_bucket_v2: '0_24h' }, { _id: 1, time_bucket_v2: 1, county: 1, bond_amount: 1, bond: 1, bond_label: 1, full_name: 1, charge: 1, category: 1, agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, normalized_at: 1, scraped_at: 1 }, { needCounty: true, needBond: true }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        ...(countyFilter ? [{ $match: countyFilter }] : []),
        { $sort: { scraped_at: -1, normalized_at: -1, bond_amount: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, person: '$full_name', county: 1, category: 1, bond_amount: 1, bond: 1, offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, needs_attention: 1, attention_reasons: 1, time_bucket_v2: 1, normalized_at: 1, scraped_at: 1 } }
      ];
    } else {
      // Legacy path unchanged (still uses normalization & booking_dt sort)
      pipeline = [
        ...unionAll(buildWindowMatch('24h'), { ...P, booking_datetime: 1, time_bucket_v2: 1, booking_derivation_source: 1 }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        ...(countyFilter ? [{ $match: countyFilter }] : []),
        { $sort: { booking_dt: -1, booking_date: -1, bond_amount: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, person: '$full_name', county: 1, category: 1, booking_date: 1, bond_amount: '$bond_amount', bond: '$bond', offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, bond_status: 1, bond_raw: 1, needs_attention: 1, attention_reasons: 1, time_bucket: 1, time_bucket_v2: 1, booking_datetime: 1, booking_derivation_source: 1, normalized_at: 1, scraped_at: 1 } }
      ];
    }
    const cursor = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
    const rawItems = await withTimeout((cursor.maxTimeMS ? cursor.maxTimeMS(MAX_DB_MS) : cursor).toArray(), MAX_DB_MS, 'new.items').catch(() => []);
    const metaNew = await fetchContactedCaseIds(rawItems.map(it => it.id));
    let items = rawItems.map(it => ({
      ...it,
      contacted: metaNew.contactSet.has(String(it.id)),
      last_contact_at: metaNew.lastMap.get(String(it.id)) || null,
      mapped_window: useV2 ? '24h' : '24h'
    }));
    // Fallback: if v2 fast path yielded 0 but legacy might have records (rare), retry heavy path once
    if (useV2 && items.length === 0) {
      variant = 'v2-buckets-fast-new-fallback';
      const heavy = baseColl(db).aggregate([
        ...unionAll(buildWindowMatchV2('24h'), { ...P, booking_datetime: 1, time_bucket_v2: 1, booking_derivation_source: 1 }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        ...(countyFilter ? [{ $match: countyFilter }] : []),
        { $sort: { booking_dt: -1, booking_date: -1, bond_amount: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, person: '$full_name', county: 1, category: 1, booking_date: 1, bond_amount: '$bond_amount', bond: '$bond', offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, bond_status: 1, bond_raw: 1, needs_attention: 1, attention_reasons: 1, time_bucket: 1, time_bucket_v2: 1, booking_datetime: 1, booking_derivation_source: 1, normalized_at: 1, scraped_at: 1 } }
      ]);
      const heavyItems = await withTimeout((heavy.maxTimeMS ? heavy.maxTimeMS(MAX_DB_MS) : heavy).toArray(), MAX_DB_MS, 'new.items.fallback').catch(() => []);
      const metaH = await fetchContactedCaseIds(heavyItems.map(it => it.id));
      items = heavyItems.map(it => ({
        ...it,
        contacted: metaH.contactSet.has(String(it.id)),
        last_contact_at: metaH.lastMap.get(String(it.id)) || null,
        mapped_window: '24h'
      }));
    }
    const contactedCountNew = items.filter(i => i.contacted).length;
    const summary = { total: items.length, contacted: contactedCountNew, uncontacted: items.length - contactedCountNew };

  const aggTicker = baseColl(db).aggregate([
  ...unionAll(useV2 ? buildWindowMatchV2('24h') : buildWindowMatch('24h'), { county: 1 }),
    ...(countyFilter ? [{ $match: countyFilter }] : []),
    { $group: { _id: '$county', n: { $sum: 1 } } },
    { $project: { _id: 0, county: '$_id', n: 1 } },
    { $sort: { county: 1 } }
  ]);
    const ticker = await withTimeout((aggTicker.maxTimeMS ? aggTicker.maxTimeMS(MAX_DB_MS) : aggTicker).toArray(), MAX_DB_MS).catch(() => []);
    return { items, ticker, summary, windowUsed: '24h', mode: useV2 ? 'v2_buckets' : 'legacy', pathVariant: useV2 ? variant : 'legacy' };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  if (data?.pathVariant) res.set('X-New-Variant', data.pathVariant);
  res.json(data);
}));

// ===== RECENT (48–72h window) =====
r.get('/recent', withMetrics('recent', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
  const attentionOnly = req.query.attention === '1' || req.query.attention === 'true';
  const cacheKey = `recent:v2:${limit}:${attentionOnly}:${useV2}`;
  const { fromCache, data } = await withCache(cacheKey, async () => {
    let variant = useV2 ? 'v2-buckets-fast-recent' : 'legacy';
    let items = [];
    let count48h = 0, count72h = 0, bond48h = 0, bond72h = 0;
    if (useV2) {
      // Accurate counts & bonds (no limit)
      const countPipe = [
        ...unionBucketsFast({ time_bucket_v2: { $in: ['24_48h','48_72h'] } }, { time_bucket_v2: 1, bond_amount: 1 }, { needBond: true }),
        { $group: { _id: '$time_bucket_v2', n: { $sum: 1 }, bond: { $sum: { $ifNull: ['$bond_amount', 0] } } } }
      ];
      const curCounts = baseColl(db).aggregate(countPipe);
      const countRows = await withTimeout((curCounts.maxTimeMS ? curCounts.maxTimeMS(MAX_DB_MS) : curCounts).toArray(), MAX_DB_MS, 'recent.counts').catch(() => []);
      countRows.forEach(r => {
        if (r._id === '24_48h') { count48h = r.n; bond48h = r.bond; }
        if (r._id === '48_72h') { count72h = r.n; bond72h = r.bond; }
      });
      // Limited item list
      const pipeline = [
        ...unionBucketsFast({ time_bucket_v2: { $in: ['24_48h','48_72h'] } }, { _id: 1, time_bucket_v2: 1, county: 1, bond_amount: 1, bond: 1, bond_label: 1, full_name: 1, charge: 1, category: 1, agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, normalized_at: 1, scraped_at: 1 }, { needCounty: true, needBond: true }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        { $sort: { scraped_at: -1, normalized_at: -1, bond_amount: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, person: '$full_name', county: 1, category: 1, bond_amount: 1, bond: 1, offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, needs_attention: 1, attention_reasons: 1, time_bucket_v2: 1, normalized_at: 1, scraped_at: 1 } }
      ];
      const cur = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
      const raw = await withTimeout((cur.maxTimeMS ? cur.maxTimeMS(MAX_DB_MS) : cur).toArray(), MAX_DB_MS, 'recent.items').catch(() => []);
      const metaR = await fetchContactedCaseIds(raw.map(r => r.id));
      items = raw.map(r => ({
        ...r,
        contacted: metaR.contactSet.has(String(r.id)),
        last_contact_at: metaR.lastMap.get(String(r.id)) || null,
        mapped_window: r.time_bucket_v2 === '24_48h' ? '48h' : r.time_bucket_v2 === '48_72h' ? '72h' : null,
      }));
      // Fallback if empty (rare) -> heavy path
      if (!items.length) {
        variant = 'v2-buckets-fast-recent-fallback';
      }
    }
    if (!useV2 || (useV2 && items.length === 0)) {
      // Legacy / fallback heavy path
      const [c48, c72, b48, b72] = await Promise.all([
        countByWindow(db, '48h', useV2),
        countByWindow(db, '72h', useV2),
        sumBondForWindow(db, '48h', useV2),
        sumBondForWindow(db, '72h', useV2),
      ]);
      count48h = c48; count72h = c72; bond48h = b48; bond72h = b72;
      const match48 = useV2 ? buildWindowMatchV2('48h') : buildWindowMatch('48h');
      const match72 = useV2 ? buildWindowMatchV2('72h') : buildWindowMatch('72h');
      const recentMatchOr = [match48, match72].filter(m => m && Object.keys(m).length);
      const recentMatch = recentMatchOr.length ? { $or: recentMatchOr } : {};
      const heavyAgg = baseColl(db).aggregate([
        ...unionAll(recentMatch, { ...P, booking_datetime: 1, time_bucket_v2: 1, booking_derivation_source: 1 }),
        ...(attentionOnly ? attentionStages(true) : attentionStages(false)),
        { $sort: { booking_dt: -1, booking_date: -1, bond_amount: -1 } },
        { $limit: limit },
        { $project: { _id: 0, id: { $toString: '$_id' }, person: '$full_name', county: 1, category: 1, booking_date: 1, bond_amount: '$bond_amount', bond: '$bond', offense: '$charge', agency: 1, facility: 1, race: 1, sex: 1, case_number: 1, spn: 1, needs_attention: 1, attention_reasons: 1, bond_status: 1, bond_raw: 1, time_bucket: 1, time_bucket_v2: 1, booking_datetime: 1, booking_derivation_source: 1, normalized_at: 1, scraped_at: 1 } }
      ]);
      const heavyRaw = await withTimeout((heavyAgg.maxTimeMS ? heavyAgg.maxTimeMS(MAX_DB_MS) : heavyAgg).toArray(), MAX_DB_MS, 'recent.heavy').catch(() => []);
      const metaH = await fetchContactedCaseIds(heavyRaw.map(r => r.id));
      items = heavyRaw.map(r => ({
        ...r,
        contacted: metaH.contactSet.has(String(r.id)),
        last_contact_at: metaH.lastMap.get(String(r.id)) || null,
        mapped_window: useV2 ? (r.time_bucket_v2 === '24_48h' ? '48h' : r.time_bucket_v2 === '48_72h' ? '72h' : null) : null,
      }));
    }
    const contactedRecent = items.filter(i => i.contacted).length;
    // Ticker (per-county counts) using fast path if available
    let ticker = [];
    try {
      if (useV2 && items.length) {
        const tPipe = [
          ...unionBucketsFast({ time_bucket_v2: { $in: ['24_48h','48_72h'] } }, { county: 1, time_bucket_v2: 1 }, { needCounty: true }),
          { $group: { _id: { county: '$county' }, n: { $sum: 1 } } },
          { $project: { _id: 0, county: '$_id.county', n: 1 } },
          { $sort: { county: 1 } }
        ];
        const curT = baseColl(db).aggregate(tPipe);
        ticker = await withTimeout((curT.maxTimeMS ? curT.maxTimeMS(MAX_DB_MS) : curT).toArray(), MAX_DB_MS, 'recent.ticker.fast').catch(() => []);
      } else {
        const aggT = baseColl(db).aggregate([
          ...unionAll({ $or: [{ time_bucket_v2: '24_48h' }, { time_bucket_v2: '48_72h' }] }, { county: 1 }),
          { $group: { _id: '$county', n: { $sum: 1 } } },
          { $project: { _id: 0, county: '$_id', n: 1 } },
          { $sort: { county: 1 } }
        ]);
        ticker = await withTimeout((aggT.maxTimeMS ? aggT.maxTimeMS(MAX_DB_MS) : aggT).toArray(), MAX_DB_MS, 'recent.ticker.heavy').catch(() => []);
      }
    } catch {}
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
      mode: useV2 ? 'v2_buckets' : 'legacy',
      pathVariant: useV2 ? variant : 'legacy'
    };
  });
  res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  if (data?.pathVariant) res.set('X-Recent-Variant', data.pathVariant);
  res.json(data);
}));

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
r.get('/per-county', withMetrics('per-county', async (req, res) => {
  try {
    const db = ensureDb(res); if (!db) return;
    const win = (req.query.window || '24h').toLowerCase();
    const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
    const cacheKey = `perCounty:v2:${win}`;
    const { fromCache, data } = await withCache(cacheKey, async () => {
      let rows = [];
      let pathVariant = useV2 ? 'v2-buckets-fast-per-county' : 'legacy';
      if (useV2) {
        // Bucket-based grouping path
        const bucketPipeline = [
          ...unionAllFast({}, { county: 1, time_bucket_v2: 1, bond_amount: 1 }, { needBond: true }),
          { $group: { _id: { county: '$county', b: '$time_bucket_v2' }, n: { $sum: 1 }, bondSum: { $sum: { $ifNull: ['$bond_amount', 0] } } } },
          { $project: { _id: 0, county: '$_id.county', bucket: '$_id.b', n: 1, bondSum: 1 } }
        ];
        const aggB = baseColl(db).aggregate(bucketPipeline, { allowDiskUse: true });
        const bucketRows = await withTimeout((aggB.maxTimeMS ? aggB.maxTimeMS(MAX_DB_MS) : aggB).toArray(), MAX_DB_MS).catch(() => []);
        const byCounty = new Map();
        bucketRows.forEach(r => {
          const c = r.county; if (!byCounty.has(c)) byCounty.set(c, { county: c, counts: { today:0,yesterday:0,twoDaysAgo:0,last7d:0,last30d:0 }, bondValue:0, bondToday:0 });
          const rec = byCounty.get(c);
          switch (r.bucket) {
            case '0_24h': rec.counts.today += r.n; rec.bondToday += r.bondSum; break;
            case '24_48h': rec.counts.yesterday += r.n; break;
            case '48_72h': rec.counts.twoDaysAgo += r.n; break;
            default: break;
          }
          // Aggregated windows
          if (['0_24h','24_48h','48_72h','3d_7d'].includes(r.bucket)) rec.counts.last7d += r.n;
          if (['0_24h','24_48h','48_72h','3d_7d','7d_30d'].includes(r.bucket)) rec.counts.last30d += r.n;
          // Bond window for requested win
          const bucketsForWin = bucketsForWindow(win);
            if (bucketsForWin.includes(r.bucket)) rec.bondValue += r.bondSum;
        });
        rows = Array.from(byCounty.values()).sort((a,b)=>a.county.localeCompare(b.county));
      } else {
        // Legacy hour-diff path
        const since30 = new Date(Date.now() - 30 * 24 * 3600000);
        const match = { booking_dt: { $gte: since30 } };
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
          { $set: { hoursAgo: { $dateDiff: { startDate: '$booking_dt', endDate: '$$NOW', unit: 'hour' } } } },
          { $group: { _id: '$county', today: { $sum: { $cond: [{ $lt: ['$hoursAgo', 24] }, 1, 0] } }, yesterday: { $sum: { $cond: [{ $and: [{ $gte: ['$hoursAgo', 24] }, { $lt: ['$hoursAgo', 48] }] }, 1, 0] } }, twoDaysAgo: { $sum: { $cond: [{ $and: [{ $gte: ['$hoursAgo', 48] }, { $lt: ['$hoursAgo', 72] }] }, 1, 0] } }, last7d: { $sum: { $cond: [{ $lt: ['$hoursAgo', 24 * 7] }, 1, 0] } }, last30d: { $sum: { $cond: [{ $lt: ['$hoursAgo', 24 * 30] }, 1, 0] } }, bondToday: { $sum: { $cond: [{ $lt: ['$hoursAgo', 24] }, { $ifNull: ['$bond_amount', 0] }, 0] } }, bondWindow: { $sum: { $cond: [winCond, { $ifNull: ['$bond_amount', 0] }, 0] } } } },
          { $project: { _id: 0, county: '$_id', counts: { today: '$today', yesterday: '$yesterday', twoDaysAgo: '$twoDaysAgo', last7d: '$last7d', last30d: '$last30d' }, bondValue: '$bondWindow', bondToday: 1 } },
          { $sort: { county: 1 } }
        ];
        const agg = baseColl(db).aggregate(pipeline, { allowDiskUse: true });
        rows = await withTimeout((agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg).toArray(), MAX_DB_MS).catch(() => []);
      }

      // Ensure all counties are present
      const counties = COUNTY_COLLECTIONS.map((c) => c.replace('simple_', ''));
      const map = new Map(rows.map((r) => [String(r.county || '').toLowerCase(), r]));
      const items = counties.map((cty) => (
        map.get(cty) || { county: cty, counts: { today: 0, yesterday: 0, twoDaysAgo: 0, last7d: 0, last30d: 0 }, bondValue: 0, bondToday: 0 }
      ));

      return { items, windowUsed: win, pathVariant };
    });
    res.set('X-Cache', fromCache ? 'HIT' : 'MISS');
    if (data?.pathVariant) res.set('X-PerCounty-Variant', data.pathVariant);
    res.json(data);
  } catch (err) {
    console.error('per-county error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
}));

// ===== DIAGNOSTICS (window bounds + sample) =====
r.get('/diag', async (req, res) => {
  const db = ensureDb(res); if (!db) return;
  const win = (req.query.window || '24h').toLowerCase();
  const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
  const rawMode = req.query.raw === '1' || req.query.raw === 'true';
  const match = rawMode ? {} : (useV2 ? buildWindowMatchV2(win) : buildWindowMatch(win));

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
    ...unionAllFast(match, { county: 1, booking_dt: 1, bond_amount: 1, booking_date: 1, time_bucket_v2: 1, booking_datetime: 1, booking_derivation_source: 1 }, { needBookingDt: true, needBond: true }),
    { $facet: Object.assign({
      sample: [ { $sort: { booking_dt: -1 } }, { $limit: 5 }, { $project: { _id: 0, county: 1, booking_dt: 1, bond_amount: 1, booking_date: 1, time_bucket_v2: 1 } } ],
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
        { $project: { _id: 0, county: 1, booking_date: 1, booking_dt: 1, bond_amount: 1, time_bucket_v2: 1 } }
      ]
    } : {}, useV2 ? {
      bucketDist: [
        { $group: { _id: '$time_bucket_v2', n: { $sum: 1 } } },
        { $project: { _id: 0, bucket: '$_id', n: 1 } },
        { $sort: { bucket: 1 } }
      ],
      bucketCoverage: [
        { $group: { _id: null, withBucket: { $sum: { $cond: [{ $ne: ['$time_bucket_v2', null] }, 1, 0] } }, withoutBucket: { $sum: { $cond: [{ $eq: ['$time_bucket_v2', null] }, 1, 0] } } } },
        { $project: { _id: 0, withBucket: 1, withoutBucket: 1, coverageRate: { $cond: [{ $gt: [{ $add: ['$withBucket', '$withoutBucket'] }, 0] }, { $divide: ['$withBucket', { $add: ['$withBucket', '$withoutBucket'] }] }, 0] } } }
      ]
    } : {}) }
  ];
  let count = 0; let bondSum = 0; let sample = []; let recentAudit = []; let recentLatest = [];
  let bucketDist = []; let bucketCoverage = null;
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
      if (useV2) {
        bucketDist = doc.bucketDist || [];
        bucketCoverage = Array.isArray(doc.bucketCoverage) && doc.bucketCoverage.length ? doc.bucketCoverage[0] : null;
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'diag failed', message: e?.message });
  }
  res.set('X-Perf-Window', win);
  res.json({ window: win, windowUsed: win, mode: useV2 ? 'v2_buckets' : 'legacy', rawMode, since, until, match, count, bondSum, sample, recentAudit, recentLatest, bucketDist, bucketCoverage });
});

export default r;
