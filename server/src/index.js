import './config/loadEnv.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { connectMongo, getMongo } from './db.js';
import { ensureDashboardIndexes } from './indexes.js';
import health from './routes/health.js';
import dashboard from './routes/dashboard.js';
import cases from './routes/cases.js';
import checkins from './routes/checkins.js';
import documents from './routes/documents.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import accessRequestRoutes from './routes/accessRequests.js';
import metadataRoutes from './routes/metadata.js';
import paymentRoutes, { stripeWebhookHandler } from './routes/payments.js';
import { requireAuth } from './middleware/auth.js';

const app = express();

// Light request logger with sampling to reduce noise in production.
const LOG_SAMPLE_RATE = Number(process.env.LOG_SAMPLE_RATE || (process.env.NODE_ENV === 'production' ? 0.1 : 1));
app.use((req, _res, next) => {
  if (Math.random() < LOG_SAMPLE_RATE || req.originalUrl?.startsWith('/api/health')) {
    console.log(`➡️  ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.set('trust proxy', 1);

let openapiDoc = null;
try {
  const specText = fs.readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8');
  openapiDoc = YAML.parse(specText);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, { explorer: true }));
  app.get('/api/docs.json', (_req, res) => res.json(openapiDoc));
  console.log('📚 Swagger UI available at /api/docs');
} catch (e) {
  console.warn('⚠️  OpenAPI spec not found or invalid; /api/docs disabled:', e.message);
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const ENV_ORIGINS = (process.env.WEB_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_LOCALHOST_REGEX = /^http:\/\/localhost:\d+$/;
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const ALLOWED_ORIGINS = isProd
  ? (ENV_ORIGINS.length ? ENV_ORIGINS : [])
  : [...ENV_ORIGINS, DEFAULT_LOCALHOST_REGEX];

app.use(cors({
  origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_LOCALHOST_REGEX,
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.use('/api/health', health);
app.get('/api/health/light', (_req, res) => res.json({ ok: true, pid: process.pid, ts: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', requireAuth, dashboard);
app.use('/api/cases', requireAuth, cases);
app.use('/api/checkins', requireAuth, checkins);
app.use('/api/cases', requireAuth, documents);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/access-requests', requireAuth, accessRequestRoutes);
app.use('/api/payments', requireAuth, paymentRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/uploads', express.static(new URL('../uploads', import.meta.url).pathname));

const port = Number(process.env.PORT || 8080);

const MONGO_URI = process.env.MONGO_URI
  || process.env.MONGODB_URI
  || process.env.MONGO_URL
  || process.env.ATLAS_URI
  || process.env.DATABASE_URL;
const MONGO_DB = process.env.MONGO_DB || process.env.MONGODB_DB || 'warrantdb';

if (MONGO_URI) {
  await connectMongo(MONGO_URI, MONGO_DB);
  app.set('mongo', getMongo());
  try { ensureDashboardIndexes(getMongo()); } catch {}
} else {
  console.warn('⚠️  MONGO_URI not set — starting server without DB connection (some endpoints will return 503)');
  app.set('mongo', null);
}

const USE_TIME_BUCKET_V2 = String(process.env.DISABLE_TIME_BUCKET_V2 || 'false').toLowerCase() === 'true' ? false : true;
app.locals.flags = { USE_TIME_BUCKET_V2 };

const server = app.listen(port, () => {
  console.log(`🚀 API listening on http://localhost:${port}`);
  console.log(`🧪 Feature Flags: USE_TIME_BUCKET_V2=${USE_TIME_BUCKET_V2} (set DISABLE_TIME_BUCKET_V2=true to turn off)`);
});

server.on('connection', (sock) => {
  try {
    console.log(`🔌 new TCP connection from ${sock.remoteAddress}:${sock.remotePort} (local:${sock.localAddress}:${sock.localPort})`);
  } catch (e) {}
});

server.on('request', (req, res) => {
  try {
    console.log(`📰 server request event: ${req.method} ${req.url}`);
  } catch (e) {}
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});
