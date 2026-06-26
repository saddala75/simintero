import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import pg from 'pg';
import { GateEnforcer } from './gates/GateEnforcer.js';
import { createQueueRouter } from './routes/queue.js';
import { createApproveRouter } from './routes/approve.js';
import { createActivateRouter } from './routes/activate.js';
import type { VkasClient } from './routes/activate.js';
import { createEnqueueRouter } from './routes/enqueue.js';
import { InMemoryGovernanceStore } from './store/InMemoryGovernanceStore.js';
import { PgGovernanceStore } from './store/PgGovernanceStore.js';
import type { GovernanceStore } from './store/GovernanceStore.js';

// Re-export public types and classes
export type {
  ApprovalRecord,
  ArtifactApprovalState,
  Gate,
  SodError,
} from './gates/GateEnforcer.js';
export { GateEnforcer } from './gates/GateEnforcer.js';
export { PgGovernanceStore } from './store/PgGovernanceStore.js';
export { InMemoryGovernanceStore } from './store/InMemoryGovernanceStore.js';
export type { GovernanceStore, Decision } from './store/GovernanceStore.js';
export type { ApproveInput, ApproveSuccess } from './routes/approve.js';
export { handleApprove, createApproveRouter } from './routes/approve.js';
export type { ActivateInput, VkasClient } from './routes/activate.js';
export { handleActivate, createActivateRouter } from './routes/activate.js';
export type { QueueResult } from './routes/queue.js';
export { handleQueue, createQueueRouter } from './routes/queue.js';
export type { EnqueueInput } from './routes/enqueue.js';
export { handleEnqueue, createEnqueueRouter } from './routes/enqueue.js';

// Minimal fetch-based VKAS client for production wiring
const vkasBaseUrl = process.env['VKAS_BASE_URL'] ?? 'http://localhost:3040';

const fetchVkasClient: VkasClient = {
  activate: async (canonicalUrl: string, version: string): Promise<void> => {
    const r = await fetch(`${vkasBaseUrl}/v1/artifacts/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_url: canonicalUrl, version }),
    });
    if (!r.ok) throw new Error(`VKAS activate failed (${r.status}) for ${canonicalUrl}`);
  },
};

const governanceDbUrl = process.env['GOVERNANCE_DB_URL'];
const store: GovernanceStore = governanceDbUrl
  ? new PgGovernanceStore(new pg.Pool({ connectionString: governanceDbUrl }))
  : new InMemoryGovernanceStore();
const enforcer = new GateEnforcer();

const app: Express = express();
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-governance' });
});

app.use(createQueueRouter(store));
app.use(createEnqueueRouter(store));
app.use(createApproveRouter(store, enforcer));
app.use(createActivateRouter(store, enforcer, fetchVkasClient));

export default app;

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3014);
  app.listen(port, () => {
    console.log(`[digicore-governance] listening on :${port}`);
  });
}
