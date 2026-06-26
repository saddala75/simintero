import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { buildMarginRouter } from './routes/margin.js';

export function buildApp(pool: Pool): Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
    const sub = (req as any).sub as string | undefined
    if (tenantId) enrichSpan({ tenant_id: tenantId })
    if (sub) enrichSpan({ 'user.sub': sub })
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(buildMarginRouter(pool));
  return app;
}
