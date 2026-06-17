import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { buildClaimsRouter } from './routes/claims.js';
import { buildAppealsRouter } from './routes/appeals.js';
import { buildIRORouter } from './routes/iro.js';

/** Build the claims-service Express app (no listen — testable). */
export function buildApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/v1/claims', buildClaimsRouter(pool));
  app.use('/v1/appeals', buildAppealsRouter(pool));
  app.use('/v1/iro', buildIRORouter(pool));
  return app;
}
