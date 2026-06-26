import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createTerminologyRouter } from './router.js';

const VKAS_URL = process.env['VKAS_URL'] ?? 'http://localhost:3040';
const PORT = Number(process.env['PORT'] ?? 3030);

const app: Express = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(createTerminologyRouter(VKAS_URL));

if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => console.log(`terminology-service listening on :${PORT}`));
}

export { app };
