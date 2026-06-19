import { Router, type Request, type Response } from 'express';
import { ulid } from 'ulid';
import { withTenant } from './db/withTenant.js';
import { appendTaskEvent } from './outbox.js';

export function tenantOf(req: Request, res: Response): string | null {
  const t = req.headers['x-sim-tenant-id'] as string | undefined;
  if (!t) {
    res.status(401).json({ code: 'MISSING_TENANT_ID', detail: 'x-sim-tenant-id is required' });
    return null;
  }
  return t;
}

export function createTaskRouter(): Router {
  const router = Router();

  router.post('/v1/tasks', async (req, res, next) => {
    const tenant = tenantOf(req, res);
    if (!tenant) return;
    try {
      const b = req.body as Record<string, any>;
      if (!b.task_kind || typeof b.task_kind !== 'string') {
        res.status(400).json({ code: 'MISSING_FIELDS', detail: 'task_kind is required' });
        return;
      }
      const taskId = 'task_' + ulid();
      const pool = req.app.locals['pool'];
      await withTenant(pool, tenant, async (client) => {
        await client.query(
          `INSERT INTO task.task (task_id, tenant_id, task_kind, status, assignee, assignee_queue, due_at, payload, created_by)
           VALUES ($1,$2,$3,'open',$4,$5,$6,$7::jsonb,$8)`,
          [taskId, tenant, b.task_kind, b.assignee ?? null, b.assignee_queue ?? null, b.due_at ?? null,
           JSON.stringify(b.payload ?? {}), b.created_by ?? null]);
        await appendTaskEvent(client, tenant, 'TaskCreated', taskId, { task_kind: b.task_kind, status: 'open' });
      });
      res.status(201).json({ task_id: taskId, status: 'open' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
