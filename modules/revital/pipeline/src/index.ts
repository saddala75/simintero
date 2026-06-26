import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Request, type Response, type NextFunction } from 'express';
import pg from 'pg';
import { Connection, Client } from '@temporalio/client';
import { createAnalysesRouter } from './routes/analyses.js';
import { createFeedbackRouter } from './routes/feedback.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const PORT = Number(process.env['PORT'] ?? 3050);
const TEMPORAL_ADDRESS = process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233';

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const temporalClient = new Client({ connection, namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'simintero' });

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
  app.use(createAnalysesRouter(pool, temporalClient.workflow));
  app.use(createFeedbackRouter(pool));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 500).json({ code: 'INTERNAL_ERROR', detail: e.message ?? 'Unexpected error' });
  });

  app.listen(PORT, () => console.log(`Revital pipeline service listening on :${PORT}`));
}

main().catch(console.error);
