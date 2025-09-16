import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { connectMongo, getMongo } from './db.js';
import health from './routes/health.js';
import dashboard from './routes/dashboard.js';
import cases from './routes/cases.js';

const app = express();

app.set('trust proxy', 1);

// security & basics
app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: process.env.WEB_ORIGIN || [/^http:\/\/localhost:\d+$/],
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// routes
app.use('/api/health', health);
app.use('/api/dashboard', dashboard);
app.use('/api/cases', cases);

const port = Number(process.env.PORT || 8080);

await connectMongo(process.env.MONGO_URI, process.env.MONGO_DB);
app.set('mongo', getMongo());
app.listen(port, () => console.log(`🚀 API listening on http://localhost:${port}`));

// basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});