import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import pg from 'pg';
import { createVkasRouter } from './router.js';

const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost/simintero';
const PORT = Number(process.env['PORT'] ?? 3040);

const pool = new pg.Pool({ connectionString: DB_URL });

const app: Express = express();
app.use(express.json());
app.locals['pool'] = pool;
app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createVkasRouter());

app.listen(PORT, () => console.log(`VKAS listening on :${PORT}`));

export { app };
