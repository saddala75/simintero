import express, { type Express } from 'express';
import type { Request, Response } from 'express';
import { ProcessIntakeCommand } from './commands/ProcessIntakeCommand.js';
import type { IntakeCommand } from './commands/ProcessIntakeCommand.js';
import { createTenantDb } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

const app: Express = express();
app.use(express.json());

// Dependency injection: callers should set this before starting
let tenantDb: TenantDb | null = null;

export function setDb(db: TenantDb): void {
  tenantDb = db;
}

function validateIntakeCommand(body: unknown): body is IntakeCommand {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b['channel'] === 'string' &&
    ['PAS', 'X12_278', 'PORTAL', 'FAX_OCR'].includes(b['channel']) &&
    typeof b['rawPayloadRef'] === 'string' &&
    typeof b['receivedAt'] === 'string' &&
    typeof b['memberRef'] === 'string' &&
    typeof b['coverageRef'] === 'string' &&
    Array.isArray(b['serviceLines']) &&
    typeof b['urgency'] === 'string' &&
    ['standard', 'expedited'].includes(b['urgency'])
  );
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'enstellar-intake' });
});

app.post('/internal/intake/commands', async (req: Request, res: Response) => {
  if (!tenantDb) {
    res.status(503).json({ error: 'DB not initialised' });
    return;
  }

  if (!validateIntakeCommand(req.body)) {
    res.status(400).json({ error: 'Invalid IntakeCommand payload' });
    return;
  }

  const command = req.body;
  const processor = new ProcessIntakeCommand(tenantDb);

  try {
    const result = await processor.execute(command);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // No PHI in logs
    console.error('[intake] command failed', { message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;

// Standalone start when invoked directly
if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3003);
  app.listen(port, () => {
    console.log(`[enstellar-intake] listening on :${port}`);
  });
}
