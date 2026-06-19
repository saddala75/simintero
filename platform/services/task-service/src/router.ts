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

  router.get('/v1/tasks', async (req, res, next) => {
    const tenant = tenantOf(req, res);
    if (!tenant) return;
    try {
      const { status, task_kind, assignee, assignee_queue } = req.query as Record<string, string>;
      const page = Math.max(1, parseInt((req.query['page'] as string) ?? '1', 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt((req.query['page_size'] as string) ?? '50', 10) || 50));
      const where: string[] = [];
      const params: any[] = [];
      for (const [col, val] of [['status', status], ['task_kind', task_kind], ['assignee', assignee], ['assignee_queue', assignee_queue]] as const) {
        if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
      }
      params.push(pageSize, (page - 1) * pageSize);
      const sql = `SELECT task_id, task_kind, status, assignee, assignee_queue, due_at, payload, created_at, updated_at, resolved_at
                   FROM task.task ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY due_at NULLS LAST, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
      const pool = req.app.locals['pool'];
      const tasks = await withTenant(pool, tenant, async (c) => (await c.query(sql, params)).rows);
      res.json({ tasks, page, page_size: pageSize });
    } catch (err) {
      next(err);
    }
  });

  router.get('/v1/tasks/:id', async (req, res, next) => {
    const tenant = tenantOf(req, res);
    if (!tenant) return;
    try {
      const pool = req.app.locals['pool'];
      const row = await withTenant(pool, tenant, async (c) =>
        (await c.query(`SELECT * FROM task.task WHERE task_id = $1`, [req.params['id']])).rows[0]);
      if (!row) { res.status(404).json({ code: 'NOT_FOUND', detail: 'task not found' }); return; }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
