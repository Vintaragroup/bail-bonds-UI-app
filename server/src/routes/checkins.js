import { Router } from 'express';
import mongoose from 'mongoose';
import CheckIn from '../models/CheckIn.js';

const r = Router();
const MAX_DB_MS = 5000;

function withTimeout(promise, ms = MAX_DB_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('operation timed out')), ms)),
  ]);
}

function ensureMongoConnected(res) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }
  return true;
}

function normalize(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() || doc._id,
    caseId: doc.caseId?.toString?.() || doc.caseId || null,
    person: doc.person || 'Unknown',
    county: doc.county || 'unknown',
    dueAt: doc.dueAt,
    method: doc.method,
    status: doc.status,
    note: doc.note || '',
    contactCount: doc.contactCount || 0,
    lastContactAt: doc.lastContactAt || null,
    location: doc.location || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function dateRangeForScope(scope = 'today') {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  if (scope === 'today') {
    return { start, end, includeDone: false };
  }
  if (scope === 'overdue') {
    return { start, end: start, includeDone: false, overdueOnly: true };
  }
  return { start: null, end: null, includeDone: true };
}

r.get('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const scope = String(req.query.scope || 'today').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);

    const { start, end, includeDone, overdueOnly } = dateRangeForScope(scope);
    const filter = {};

    if (overdueOnly && start) {
      filter.dueAt = { $lt: start };
      filter.status = { $ne: 'done' };
    } else if (start && end) {
      filter.dueAt = { $gte: start, $lt: end };
      if (!includeDone) filter.status = { $ne: 'done' };
    }

    const cursor = CheckIn.find(filter)
      .sort({ dueAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();

    const docs = await withTimeout((cursor.maxTimeMS ? cursor.maxTimeMS(MAX_DB_MS) : cursor), MAX_DB_MS).catch((err) => {
      console.error('checkins list error', err?.message);
      return [];
    });

    const items = docs.map(normalize);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayQuery = CheckIn.countDocuments({
      dueAt: { $gte: todayStart, $lt: todayEnd },
      status: { $ne: 'done' },
    });

    const overdueQuery = CheckIn.countDocuments({
      dueAt: { $lt: todayStart },
      status: { $ne: 'done' },
    });

    const completedQuery = CheckIn.countDocuments({ status: 'done' });

    const [todayCount, overdueCount, completedCount] = await Promise.all([
      withTimeout((todayQuery.maxTimeMS ? todayQuery.maxTimeMS(MAX_DB_MS) : todayQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((overdueQuery.maxTimeMS ? overdueQuery.maxTimeMS(MAX_DB_MS) : overdueQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((completedQuery.maxTimeMS ? completedQuery.maxTimeMS(MAX_DB_MS) : completedQuery).exec(), MAX_DB_MS).catch(() => 0),
    ]);

    res.json({
      scope,
      limit,
      items,
      stats: {
        totalToday: todayCount,
        overdue: overdueCount,
        completed: completedCount,
      },
    });
  } catch (err) {
    console.error('GET /checkins error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/status', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const status = String(req.body?.status || '').toLowerCase();
    const note = req.body?.note ? String(req.body.note) : undefined;

    if (!['pending', 'overdue', 'done'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const update = { status, updatedAt: new Date() };
    if (note !== undefined) update.note = note;
    if (status === 'done') update.completedAt = new Date();

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins status update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    res.json(normalize(doc));
  } catch (err) {
    console.error('PATCH /checkins/:id/status error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/contact', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const now = new Date();
    const inc = Number(req.body?.increment || 1) || 1;

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(
        req.params.id,
        {
          $inc: { contactCount: inc },
          $set: { lastContactAt: now },
        },
        { new: true }
      ).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins contact update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    res.json(normalize(doc));
  } catch (err) {
    console.error('PATCH /checkins/:id/contact error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
