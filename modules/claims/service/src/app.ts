import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { buildClaimsRouter } from './routes/claims.js';
import { buildAppealsRouter } from './routes/appeals.js';
import { buildIRORouter } from './routes/iro.js';

/** Build the claims-service Express app (no listen — testable). */
export function buildApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
    const sub = (req as any).sub as string | undefined
    if (tenantId) enrichSpan({ tenant_id: tenantId })
    if (sub) enrichSpan({ 'user.sub': sub })
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/v1/claims', buildClaimsRouter(pool));
  app.use('/v1/appeals', buildAppealsRouter(pool));
  app.use('/v1/iro', buildIRORouter(pool));
  return app;
}
