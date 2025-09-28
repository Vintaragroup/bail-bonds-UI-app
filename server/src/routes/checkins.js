import { Router } from 'express';
import mongoose from 'mongoose';
import CheckIn from '../models/CheckIn.js';
import CheckInPing from '../models/CheckInPing.js';
import { filterByDepartment } from './utils/authz.js';
import { assertPermission as ensurePermission } from './utils/authz.js';

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
    clientId: doc.clientId?.toString?.() || null,
    caseId: doc.caseId?.toString?.() || doc.caseId || null,
    person: doc.person || 'Unknown',
    county: doc.county || 'unknown',
    dueAt: doc.dueAt,
    timezone: doc.timezone || 'UTC',
    officerId: doc.officerId?.toString?.() || null,
    method: doc.method,
    status: doc.status,
    note: doc.note || '',
    contactCount: doc.contactCount || 0,
    lastContactAt: doc.lastContactAt || null,
    location: doc.location || null,
    remindersEnabled: typeof doc.remindersEnabled === 'boolean' ? doc.remindersEnabled : true,
    gpsEnabled: Boolean(doc.gpsEnabled),
    pingsPerDay: doc.pingsPerDay || 0,
    lastPingAt: doc.lastPingAt || null,
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
  if (scope === 'upcoming') {
    const futureEnd = new Date(start);
    futureEnd.setDate(futureEnd.getDate() + 7);
    return { start: end, end: futureEnd, includeDone: false };
  }
  return { start: null, end: null, includeDone: true };
}

r.get('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const scope = String(req.query.scope || 'today').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const officerFilter = {};
    const searchFilter = {};

    const officerId = typeof req.query.officer === 'string' ? req.query.officer.trim() : '';
    if (officerId && officerId !== 'all') {
      if (mongoose.Types.ObjectId.isValid(officerId)) {
        officerFilter.officerId = new mongoose.Types.ObjectId(officerId);
      } else {
        officerFilter['meta.officerName'] = { $regex: officerId, $options: 'i' };
      }
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      searchFilter.person = { $regex: search, $options: 'i' };
    }

    const { start, end, includeDone, overdueOnly } = dateRangeForScope(scope);
    const queryFilter = { ...officerFilter, ...searchFilter };

    if (overdueOnly && start) {
      queryFilter.dueAt = { $lt: start };
      queryFilter.status = { $ne: 'done' };
    } else if (start && end) {
      queryFilter.dueAt = { $gte: start, $lt: end };
      if (!includeDone) queryFilter.status = { $ne: 'done' };
    }

    const scopedFilter = filterByDepartment(queryFilter, req, ['county'], { includeUnassigned: true });

    const cursor = CheckIn.find(scopedFilter)
      .sort({ dueAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();

    const docs = await withTimeout((cursor.maxTimeMS ? cursor.maxTimeMS(MAX_DB_MS) : cursor), MAX_DB_MS).catch((err) => {
      console.error('checkins list error', err?.message);
      return [];
    });

    const items = docs.map(normalize);

    const buildCountFilter = (rangeScope, extra = {}) => {
      const range = dateRangeForScope(rangeScope);
      const filter = { ...officerFilter, ...searchFilter, ...extra };
      if (range.overdueOnly && range.start) {
        filter.dueAt = { $lt: range.start };
        filter.status = { $ne: 'done' };
      } else if (range.start && range.end) {
        filter.dueAt = { $gte: range.start, $lt: range.end };
        if (!range.includeDone) filter.status = { $ne: 'done' };
      }
      return filterByDepartment(filter, req, ['county'], { includeUnassigned: true });
    };

    const todayQuery = CheckIn.countDocuments(buildCountFilter('today'));
    const overdueQuery = CheckIn.countDocuments(buildCountFilter('overdue'));
    const completedQuery = CheckIn.countDocuments(
      filterByDepartment({ ...officerFilter, ...searchFilter, status: 'done' }, req, ['county'], { includeUnassigned: true })
    );
    const gpsEnabledQuery = CheckIn.countDocuments(
      filterByDepartment({ ...officerFilter, ...searchFilter, gpsEnabled: true }, req, ['county'], { includeUnassigned: true })
    );

    const [todayCount, overdueCount, completedCount, gpsEnabledCount] = await Promise.all([
      withTimeout((todayQuery.maxTimeMS ? todayQuery.maxTimeMS(MAX_DB_MS) : todayQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((overdueQuery.maxTimeMS ? overdueQuery.maxTimeMS(MAX_DB_MS) : overdueQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((completedQuery.maxTimeMS ? completedQuery.maxTimeMS(MAX_DB_MS) : completedQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((gpsEnabledQuery.maxTimeMS ? gpsEnabledQuery.maxTimeMS(MAX_DB_MS) : gpsEnabledQuery).exec(), MAX_DB_MS).catch(() => 0),
    ]);

    res.json({
      scope,
      limit,
      items,
      stats: {
        totalToday: todayCount,
        overdue: overdueCount,
        completed: completedCount,
        gpsEnabled: gpsEnabledCount,
      },
    });
  } catch (err) {
    console.error('GET /checkins error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/status', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/contact', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/pings/manual', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id),
      MAX_DB_MS
    ).catch(() => null);

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const scheduledFor = new Date();
    const ping = await CheckInPing.create({
      checkInId: doc._id,
      clientId: doc.clientId || undefined,
      scheduledFor,
      triggeredByUid: req.user?.uid || null,
      status: 'queued',
      channel: 'manual',
      payload: { reason: req.body?.reason || 'manual-trigger' },
    });

    doc.lastPingAt = scheduledFor;
    await doc.save();

    res.status(202).json({
      ping: {
        id: ping._id?.toString?.() || ping._id,
        status: ping.status,
        scheduledFor,
      },
    });
  } catch (err) {
    console.error('POST /checkins/:id/pings/manual error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
r.get('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins detail error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const pingLogs = await withTimeout(
      CheckInPing.find({ checkInId: doc._id })
        .sort({ scheduledFor: -1 })
        .limit(20)
        .lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins ping fetch error', err?.message);
      return [];
    });

    res.json({
      checkIn: normalize(doc),
      pings: pingLogs.map((ping) => ({
        id: ping._id?.toString?.() || ping._id,
        scheduledFor: ping.scheduledFor,
        status: ping.status,
        channel: ping.channel,
        responseAt: ping.responseAt || null,
        location: ping.location || null,
      })),
    });
  } catch (err) {
    console.error('GET /checkins/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.get('/:id/timeline', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id).lean(),
      MAX_DB_MS
    ).catch(() => null);
    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const pings = await withTimeout(
      CheckInPing.find({ checkInId: doc._id })
        .sort({ scheduledFor: 1 })
        .lean(),
      MAX_DB_MS
    ).catch(() => []);

    const timeline = [];
    timeline.push({ label: 'Scheduled', timestamp: doc.createdAt || doc.dueAt, meta: doc.timezone || 'UTC' });
    timeline.push({ label: 'Due', timestamp: doc.dueAt, meta: doc.method?.toUpperCase?.() });
    if (doc.lastContactAt) {
      timeline.push({ label: 'Last contact', timestamp: doc.lastContactAt, meta: `Attempts: ${doc.contactCount || 0}` });
    }
    if (doc.status === 'done') {
      timeline.push({ label: 'Completed', timestamp: doc.updatedAt || doc.dueAt, meta: doc.note || '' });
    }
    pings.forEach((ping) => {
      timeline.push({
        label: `Ping ${ping.status}`,
        timestamp: ping.scheduledFor,
        meta: ping.location ? `${ping.location.lat}, ${ping.location.lng}` : undefined,
      });
    });

    res.json({ timeline });
  } catch (err) {
    console.error('GET /checkins/:id/timeline error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const payload = req.body || {};
    if (!payload.person && !payload.clientId) {
      return res.status(400).json({ error: 'Client information is required' });
    }
    if (!payload.dueAt) {
      return res.status(400).json({ error: 'dueAt is required' });
    }

    const document = new CheckIn({
      clientId: payload.clientId && mongoose.Types.ObjectId.isValid(payload.clientId)
        ? new mongoose.Types.ObjectId(payload.clientId)
        : undefined,
      caseId: payload.caseId && mongoose.Types.ObjectId.isValid(payload.caseId)
        ? new mongoose.Types.ObjectId(payload.caseId)
        : undefined,
      person: payload.person || payload.personName || 'Unknown',
      county: payload.county || 'unknown',
      dueAt: new Date(payload.dueAt),
      timezone: payload.timezone || 'UTC',
      officerId: payload.officerId && mongoose.Types.ObjectId.isValid(payload.officerId)
        ? new mongoose.Types.ObjectId(payload.officerId)
        : undefined,
      method: payload.method || 'sms',
      note: payload.notes || payload.note || '',
      remindersEnabled: payload.remindersEnabled !== undefined ? Boolean(payload.remindersEnabled) : true,
      gpsEnabled: Boolean(payload.gpsEnabled),
      pingsPerDay: Math.min(Math.max(Number(payload.pingsPerDay) || 3, 1), 12),
      meta: {
        ...(payload.locationText ? { locationText: payload.locationText } : {}),
      },
    });

    const saved = await document.save();
    res.status(201).json({ checkIn: normalize(saved.toObject()) });
  } catch (err) {
    console.error('POST /checkins error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.put('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const payload = req.body || {};
    const update = {};
    if (payload.dueAt) update.dueAt = new Date(payload.dueAt);
    if (payload.timezone) update.timezone = payload.timezone;
    if (payload.method) update.method = payload.method;
    if (payload.notes !== undefined) update.note = payload.notes;
    if (payload.remindersEnabled !== undefined) update.remindersEnabled = Boolean(payload.remindersEnabled);
    if (payload.gpsEnabled !== undefined) update.gpsEnabled = Boolean(payload.gpsEnabled);
    if (payload.pingsPerDay !== undefined) update.pingsPerDay = Math.min(Math.max(Number(payload.pingsPerDay) || 3, 1), 12);
    if (payload.officerId) {
      update.officerId = mongoose.Types.ObjectId.isValid(payload.officerId)
        ? new mongoose.Types.ObjectId(payload.officerId)
        : undefined;
    }

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    res.json({ checkIn: normalize(doc) });
  } catch (err) {
    console.error('PUT /checkins/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
