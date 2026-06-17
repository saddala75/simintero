import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { buildSearchRouter } from './routes/search.js';

export function buildApp(pool: Pool): Express {
  const app = express();
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(buildSearchRouter(pool));
  return app;
}
