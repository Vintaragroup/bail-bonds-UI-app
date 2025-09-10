import { Router } from 'express';
import Case from '../models/Case.js';
const r = Router();

r.get('/', async (req, res) => {
  const { query = '', county, status, limit = 25 } = req.query;
  const filter = {};
  if (county) filter.county = county;
  if (status) filter.status = status;
  if (query) filter.$text = { $search: query }; // add a text index later
  const items = await Case.find(filter).sort({ bookedAt: -1 }).limit(Number(limit)).lean();
  res.json({ items });
});

r.get('/:id', async (req, res) => {
  const doc = await Case.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

export default r;