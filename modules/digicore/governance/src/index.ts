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
import { PgGovernanceStore } from './store/PgGovernanceStore.js';
import { requireAuth, createJwksVerifier } from './middleware/requireAuth.js';

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
    // 422 = StatusTransitionError (e.g. already active) — treat as idempotent success
    if (!r.ok && r.status !== 422) throw new Error(`VKAS activate failed (${r.status}) for ${canonicalUrl}`);
  },
};

// Fail-fast on missing GOVERNANCE_DB_URL to prevent silent degradation to in-memory fallback
export function validateGovernanceDbUrl(dbUrl: string | undefined): string {
  if (!dbUrl) {
    console.error('FATAL: GOVERNANCE_DB_URL is required. Refusing to start with in-memory fallback.');
    process.exit(1);
  }
  return dbUrl;
}

const jwksVerifier = createJwksVerifier();
const auth = requireAuth(jwksVerifier);

const app: Express = express();
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})

// Health check — no auth required
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-governance' });
});

// All mutation routes require a valid Keycloak Bearer JWT.
// The verified sub claim is injected as req.user.sub for downstream handlers.
app.use(auth);

export default app;

// Initialize store and enforcer for production use
// This is called explicitly on startup to enforce fail-fast if GOVERNANCE_DB_URL is missing.
// Tests can import and configure the app without triggering this initialization.
if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3014);
  const governanceDbUrl = validateGovernanceDbUrl(process.env['GOVERNANCE_DB_URL']);
  const store = new PgGovernanceStore(new pg.Pool({ connectionString: governanceDbUrl }));
  const enforcer = new GateEnforcer();

  // Attach routes after store initialization
  app.use(createQueueRouter(store));
  app.use(createEnqueueRouter(store));
  app.use(createApproveRouter(store, enforcer));
  app.use(createActivateRouter(store, enforcer, fetchVkasClient));

  app.listen(port, () => {
    console.log(`[digicore-governance] listening on :${port}`);
  });
}
