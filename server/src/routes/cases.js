import { Router } from 'express';
import Case from '../models/Case.js';

const r = Router();

/**
 * GET /cases
 * Query params:
 *  - query: full-text search (requires text index)
 *  - county: filter by county (e.g., 'harris')
 *  - status: optional status filter if present in schema
 *  - startDate, endDate: inclusive YYYY-MM-DD (applies to booking_date)
 *  - minBond, maxBond: numeric filters on bond_amount
 *  - sortBy: 'booking_date' | 'bond_amount' (default: 'booking_date')
 *  - order: 'desc' | 'asc' (default: 'desc')
 *  - limit: number of docs to return (default: 25)
 *
 * Notes:
 *  - Uses normalized fields: booking_date (YYYY-MM-DD), bond_amount (Number).
 *  - Falls back to legacy fields only when necessary.
 */
r.get('/', async (req, res) => {
  try {
    const {
      query = '',
      county,
      status,
      startDate,
      endDate,
      minBond,
      maxBond,
      sortBy = 'booking_date',
      order = 'desc',
      limit = 25,
    } = req.query;

    const filter = {};

    // Core filters
    if (county) filter.county = county;
    if (status) filter.status = status;

    // Text search (ensure a text index on relevant fields: full_name, offense, case_number, etc.)
    if (query) filter.$text = { $search: query };

    // Date window on normalized booking_date (YYYY-MM-DD)
    if (startDate || endDate) {
      filter.booking_date = {};
      if (startDate) filter.booking_date.$gte = String(startDate);
      if (endDate) filter.booking_date.$lte = String(endDate);
    }

    // Bond range on normalized bond_amount
    const minBondNum = Number(minBond);
    const maxBondNum = Number(maxBond);
    if (!Number.isNaN(minBondNum) || !Number.isNaN(maxBondNum)) {
      filter.bond_amount = {};
      if (!Number.isNaN(minBondNum)) filter.bond_amount.$gte = minBondNum;
      if (!Number.isNaN(maxBondNum)) filter.bond_amount.$lte = maxBondNum;
    }

    // Sorting
    const allowedSort = new Set(['booking_date', 'bond_amount']);
    const sortField = allowedSort.has(String(sortBy)) ? String(sortBy) : 'booking_date';
    const sortDir = String(order).toLowerCase() === 'asc' ? 1 : -1;

    // Select the key fields we actually use in the UI
    const projection = {
      full_name: 1,
      first_name: 1,
      last_name: 1,
      county: 1,
      offense: 1,
      agency: 1,
      facility: 1,
      booking_date: 1,       // normalized YYYY-MM-DD
      bond_amount: 1,        // normalized Number
      case_number: 1,
      booking_number: 1,
      spn: 1,
      time_bucket: 1,        // optional: present from normalizer
      // Legacy fields kept only for back-compat view (not used for sorting/sums)
      bookedAt: 1,
      booking_date_iso: 1,
      bond: 1,
    };

    const items = await Case
      .find(filter)
      .select(projection)
      .sort({ [sortField]: sortDir, booking_date: -1 }) // tie-break by recent date
      .limit(Number(limit))
      .lean();

    res.json({ items });
  } catch (err) {
    console.error('GET /cases error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cases/:id
 * Returns a single case document. Fields already normalized.
 */
r.get('/:id', async (req, res) => {
  try {
    const doc = await Case.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    console.error('GET /cases/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;