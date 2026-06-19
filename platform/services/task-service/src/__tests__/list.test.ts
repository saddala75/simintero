import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTaskRouter } from '../router.js';

function mockClient(rows: any[]) {
  const calls: { sql: string; params?: any[] | undefined }[] = [];
  return { calls, query: vi.fn(async (sql: string, params?: any[]) => { calls.push({ sql, params }); return { rows, rowCount: rows.length }; }), release: vi.fn() };
}
function appWith(client: any) {
  const app = express(); app.use(express.json());
  app.locals['pool'] = { connect: async () => client };
  app.use(createTaskRouter());
  return app;
}

describe('GET /v1/tasks (worklist)', () => {
  it('lists tasks filtered by task_kind + status, paginated', async () => {
    const c = mockClient([{ task_id: 'task_1', task_kind: 'quality-outreach', status: 'open' }]);
    const res = await request(appWith(c)).get('/v1/tasks?task_kind=quality-outreach&status=open&page=1&page_size=10')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].task_id).toBe('task_1');
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(10);
    const select = c.calls.find((x) => /FROM task\.task/i.test(x.sql))!;
    expect(select.sql).toMatch(/task_kind = \$/);
    expect(select.sql).toMatch(/status = \$/);
    expect(select.sql).toMatch(/LIMIT/);
    expect(c.calls.some((x) => /set_config\('sim\.tenant_id'/.test(x.sql))).toBe(true);
  });
  it('401 without tenant', async () => {
    const res = await request(appWith(mockClient([]))).get('/v1/tasks');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/tasks/:id', () => {
  it('returns the task', async () => {
    const c = mockClient([{ task_id: 'task_1', status: 'open' }]);
    const res = await request(appWith(c)).get('/v1/tasks/task_1').set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body.task_id).toBe('task_1');
  });
  it('404 when not found', async () => {
    const res = await request(appWith(mockClient([]))).get('/v1/tasks/nope').set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(404);
  });
});
