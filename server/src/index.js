import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { connectMongo, getMongo } from './db.js';
import health from './routes/health.js';
import dashboard from './routes/dashboard.js';
import cases from './routes/cases.js';
import checkins from './routes/checkins.js';
import documents from './routes/documents.js';

// Load .env from both repo root and server/ if present
try { dotenv.config({ path: new URL('../../.env', import.meta.url) }); } catch {}
try { dotenv.config({ path: new URL('../.env', import.meta.url) }); } catch {}

const app = express();

// Lightweight request logger to help debug stalls: logs method + path quickly
app.use((req, _res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  next();
});

app.set('trust proxy', 1);

// Serve API docs (Swagger UI) from local openapi.yaml
let openapiDoc = null;
try {
  const specText = fs.readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8');
  openapiDoc = YAML.parse(specText);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, { explorer: true }));
  console.log('📚 Swagger UI available at /api/docs');
} catch (e) {
  console.warn('⚠️  OpenAPI spec not found or invalid; /api/docs disabled:', e.message);
}

// security & basics
// Helmet with relaxed CSP so Swagger UI works in dev
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(cors({
  origin: process.env.WEB_ORIGIN || [/^http:\/\/localhost:\d+$/],
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// routes
app.use('/api/health', health);
// Light health endpoint (no DB calls) for liveness checks
app.get('/api/health/light', (_req, res) => res.json({ ok: true, pid: process.pid, ts: new Date().toISOString() }));
app.use('/api/dashboard', dashboard);
app.use('/api/cases', cases);
app.use('/api/checkins', checkins);
app.use('/api/cases', documents);
app.use('/uploads', express.static(new URL('../uploads', import.meta.url).pathname));

const port = Number(process.env.PORT || 8080);

// Resolve Mongo connection details from several common env names
const MONGO_URI = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || process.env.MONGO_URL
  || process.env.ATLAS_URI
  || process.env.DATABASE_URL;
const MONGO_DB = process.env.MONGO_DB || process.env.MONGODB_DB || 'warrantdb';

if (MONGO_URI) {
  await connectMongo(MONGO_URI, MONGO_DB);
  app.set('mongo', getMongo());
} else {
  console.warn('⚠️  MONGO_URI not set — starting server without DB connection (some endpoints will return 503)');
  app.set('mongo', null);
}

// Use the returned server instance so we can log low-level connection events
const server = app.listen(port, () => console.log(`🚀 API listening on http://localhost:${port}`));

server.on('connection', (sock) => {
  try {
    console.log(`🔌 new TCP connection from ${sock.remoteAddress}:${sock.remotePort} (local:${sock.localAddress}:${sock.localPort})`);
  } catch (e) { /* best-effort logging */ }
});

server.on('request', (req, res) => {
  try {
    console.log(`📰 server request event: ${req.method} ${req.url}`);
  } catch (e) {}
});

// basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});
