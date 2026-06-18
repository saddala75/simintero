import express from 'express';
import type { Express, Request, Response } from 'express';
import pg from 'pg';
import { GateEnforcer } from './gates/GateEnforcer.js';
import { GovernanceNotifier } from './notifications/GovernanceNotifier.js';
import type { NotificationClient } from './notifications/GovernanceNotifier.js';
import { OutboxNotificationClient } from './notifications/OutboxNotificationClient.js';
import { createQueueRouter } from './routes/queue.js';
import { createApproveRouter } from './routes/approve.js';
import { createActivateRouter } from './routes/activate.js';
import type { VkasClient } from './routes/activate.js';
import { createEnqueueRouter } from './routes/enqueue.js';
import type { ArtifactApprovalState } from './gates/GateEnforcer.js';

// Re-export public types and classes
export type {
  ApprovalRecord,
  ArtifactApprovalState,
  Gate,
  SodError,
} from './gates/GateEnforcer.js';
export { GateEnforcer } from './gates/GateEnforcer.js';
export type { NotificationClient } from './notifications/GovernanceNotifier.js';
export { GovernanceNotifier } from './notifications/GovernanceNotifier.js';
export type { ApproveInput, ApproveSuccess } from './routes/approve.js';
export { handleApprove, createApproveRouter } from './routes/approve.js';
export type { ActivateInput, VkasClient } from './routes/activate.js';
export { handleActivate, createActivateRouter } from './routes/activate.js';
export type { QueueResult } from './routes/queue.js';
export { handleQueue, createQueueRouter } from './routes/queue.js';
export type { EnqueueInput } from './routes/enqueue.js';
export { handleEnqueue, createEnqueueRouter } from './routes/enqueue.js';

// In-memory approval store (Phase 1 — no DB needed)
const approvalStore = new Map<string, ArtifactApprovalState>();

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

// No-op notification client — fallback when GOVERNANCE_DB_URL is not set
const noopNotificationClient: NotificationClient = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit: async (_event): Promise<void> => {},
};

// Wire real outbox emission when a DB URL is provided; keep no-op for local dev
let notificationClient: NotificationClient;
const governanceDbUrl = process.env['GOVERNANCE_DB_URL'];
if (governanceDbUrl) {
  const pool = new pg.Pool({ connectionString: governanceDbUrl });
  notificationClient = new OutboxNotificationClient(pool);
} else {
  notificationClient = noopNotificationClient;
}

const enforcer = new GateEnforcer();
const notifier = new GovernanceNotifier(notificationClient);

const app: Express = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-governance' });
});

app.use(createQueueRouter(approvalStore));
app.use(createEnqueueRouter(approvalStore));
app.use(createApproveRouter(approvalStore, enforcer, notifier));
app.use(createActivateRouter(approvalStore, enforcer, fetchVkasClient, notifier));

export default app;

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3014);
  app.listen(port, () => {
    console.log(`[digicore-governance] listening on :${port}`);
  });
}
