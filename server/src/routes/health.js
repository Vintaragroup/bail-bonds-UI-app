import { Router } from 'express';
import mongoose from 'mongoose';

const r = Router();

// GET /health — pings MongoDB and summarizes simple_* collections
r.get('/', async (_req, res) => {
  const started = Date.now();
  try {
    const conn = mongoose.connection;

    // 1) Ping DB
    const pingStart = Date.now();
    await conn.db.admin().command({ ping: 1 });
    const pingMs = Date.now() - pingStart;

    // 2) Inspect key collections
    const names = [
      'simple_harris',
      'simple_brazoria',
      'simple_galveston',
      'simple_fortbend',
      'simple_jefferson',
    ];

    const details = {};
    for (const name of names) {
      try {
        const col = conn.db.collection(name);
        const [count, latestDoc] = await Promise.all([
          col.estimatedDocumentCount(),
          col
            .find({}, { projection: { normalized_at: 1 } })
            .sort({ normalized_at: -1 })
            .limit(1)
            .toArray(),
        ]);
        details[name] = {
          count,
          latest_normalized_at: latestDoc?.[0]?.normalized_at || null,
        };
      } catch {
        details[name] = { count: 0, latest_normalized_at: null, error: 'unavailable' };
      }
    }

    // 3) Basic warnings
    const warnings = Object.entries(details)
      .filter(([, v]) => (v?.count ?? 0) === 0)
      .map(([k]) => `${k} has zero documents`);

    res.json({
      ok: true,
      uptime_ms: Date.now() - started,
      db: { ping_ms: pingMs, status: 'ok' },
      collections: details,
      warnings,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /health error:', err);
    res.status(500).json({ ok: false, error: 'DB health check failed', ts: new Date().toISOString() });
  }
});

// --- KPI & Trends endpoints (normalized booking_date & bond_amount) ---

// Helper to get YYYY-MM-DD for UTC today +/- offset days
function dOffset(days = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Build the union pipeline across simple_* collections
function unionSimple(match = {}, project = null) {
  const base = [
    { $match: match },
  ];
  if (project) base.push({ $project: project });

  return [
    { $match: {} },
    { $project: { _id: 0 } },
    { $replaceWith: '$$ROOT' },
    { $limit: Number.MAX_SAFE_INTEGER },
    { $facet: { __dummy: [{ $match: {} }] } }, // no-op to keep structure consistent
  ] && [
    { $match: {} },
    { $project: { _id: 0 } },
    { $match: {} },
  ] && [
    { $match: {} },
  ] && [
    { $replaceWith: '$$ROOT' },
  ] && [
    // Start with simple_harris and union others
    {
      $unionWith: {
        coll: 'simple_brazoria',
        pipeline: base,
      },
    },
    {
      $unionWith: {
        coll: 'simple_galveston',
        pipeline: base,
      },
    },
    {
      $unionWith: {
        coll: 'simple_fortbend',
        pipeline: base,
      },
    },
    {
      $unionWith: {
        coll: 'simple_jefferson',
        pipeline: base,
      },
    },
  ];
}

// GET /dashboard/kpis — high-level counts/sums for header widgets
r.get('/kpis', async (req, res) => {
  try {
    const today = dOffset(0);
    const yesterday = dOffset(-1);
    const twoDaysAgo = dOffset(-2);
    const threeDaysAgo = dOffset(-3);
    const sevenDaysAgo = dOffset(-7);

    const matchWindow7d = { booking_date: { $gte: sevenDaysAgo, $lte: today } };
    const proj = { booking_date: 1, county: 1, bond_amount: 1 };

    // Aggregate once for 7d window then slice in-memory
    const pipeline = [
      { $match: matchWindow7d },
      ...unionSimple(matchWindow7d, proj),
      { $project: { booking_date: 1, county: 1, bond_amount: { $ifNull: ['$bond_amount', 0] } } },
    ];

    // Run against simple_harris as the anchor for the union pipeline
    const anchor = req.app.get('mongo').db.collection('simple_harris');
    const docs = await anchor.aggregate(pipeline).toArray();

    const bucket = (from, to) => docs.filter(d => d.booking_date >= from && d.booking_date <= to);

    const todayDocs = bucket(today, today);
    const yDocs = bucket(yesterday, yesterday);
    const zDocs = bucket(twoDaysAgo, twoDaysAgo);
    const last72Docs = bucket(twoDaysAgo, today); // inclusive 72h (today + prev 2 days)
    const last7Docs = bucket(sevenDaysAgo, today);

    const sum = arr => arr.reduce((acc, x) => acc + (Number(x.bond_amount) || 0), 0);

    // Top counties by bond in last 24h
    const top24 = {};
    for (const d of todayDocs) {
      const k = d.county || 'unknown';
      if (!top24[k]) top24[k] = { county: k, count: 0, bond_sum: 0 };
      top24[k].count += 1;
      top24[k].bond_sum += Number(d.bond_amount) || 0;
    }
    const topCounties24h = Object.values(top24)
      .sort((a, b) => b.bond_sum - a.bond_sum)
      .slice(0, 5);

    res.json({
      ok: true,
      today: { count: todayDocs.length, bond_sum: sum(todayDocs) },
      yesterday: { count: yDocs.length, bond_sum: sum(yDocs) },
      last72h: { count: last72Docs.length, bond_sum: sum(last72Docs) },
      last7d: { count: last7Docs.length, bond_sum: sum(last7Docs) },
      topCounties24h,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /dashboard/kpis error:', err);
    res.status(500).json({ ok: false, error: 'Failed to compute KPIs' });
  }
});

// GET /dashboard/trends?days=14 — daily counts/sums for last N days
r.get('/trends', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(60, Number(req.query.days ?? 14)));
    const start = dOffset(-days + 1); // inclusive start
    const end = dOffset(0);

    const matchRange = { booking_date: { $gte: start, $lte: end } };
    const proj = { booking_date: 1, bond_amount: 1 };

    const pipeline = [
      { $match: matchRange },
      ...unionSimple(matchRange, proj),
      { $project: { booking_date: 1, bond_amount: { $ifNull: ['$bond_amount', 0] } } },
      { $group: { _id: '$booking_date', count: { $sum: 1 }, bond_sum: { $sum: '$bond_amount' } } },
      { $project: { _id: 0, date: '$_id', count: 1, bond_sum: 1 } },
      { $sort: { date: 1 } },
    ];

    const anchor = req.app.get('mongo').db.collection('simple_harris');
    const series = await anchor.aggregate(pipeline).toArray();

    res.json({ ok: true, start, end, series, ts: new Date().toISOString() });
  } catch (err) {
    console.error('GET /dashboard/trends error:', err);
    res.status(500).json({ ok: false, error: 'Failed to compute trends' });
  }
});

export default r;