import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTaskRouter } from '../router.js';

// fake client: SELECT status returns `current`; UPDATE ... RETURNING returns the updated row
function fakeClient(current: string, updatedRow: any) {
  const calls: { sql: string; params?: any[] | undefined }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: any[]) => {
      calls.push({ sql, params });
      if (/SELECT status/i.test(sql)) return { rows: current ? [{ status: current, assignee: null, assignee_queue: null }] : [], rowCount: current ? 1 : 0 };
      if (/UPDATE task\.task/i.test(sql)) return { rows: [updatedRow], rowCount: 1 };
      return { rows: [], rowCount: 1 }; // BEGIN/set_config/COMMIT/outbox
    }),
    release: vi.fn(),
  };
}
function appWith(client: any) {
  const app = express(); app.use(express.json());
  app.locals['pool'] = { connect: async () => client };
  app.use(createTaskRouter());
  return app;
}

describe('PATCH /v1/tasks/:id', () => {
  it('resolves an open task (sets resolved_at) + emits TaskResolved', async () => {
    const c = fakeClient('open', { task_id: 'task_1', status: 'resolved' });
    const res = await request(appWith(c)).patch('/v1/tasks/task_1').set('x-sim-tenant-id', 'tenant-dev').send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    const upd = c.calls.find((x) => /UPDATE task\.task/i.test(x.sql))!;
    expect(upd.sql).toMatch(/status = \$/);
    expect(upd.sql).toMatch(/resolved_at = now\(\)/);
    const outbox = c.calls.find((x) => /INSERT INTO shared\.outbox/i.test(x.sql) && (x.params as any[]).some((p) => typeof p === 'string' && p.includes('TaskResolved')));
    expect(outbox).toBeTruthy();
  });
  it('assigns (assignee + queue) + emits TaskAssigned', async () => {
    const c = fakeClient('open', { task_id: 'task_1', status: 'open', assignee: 'reviewer-a' });
    const res = await request(appWith(c)).patch('/v1/tasks/task_1').set('x-sim-tenant-id', 'tenant-dev').send({ assignee: 'reviewer-a', assignee_queue: 'quality' });
    expect(res.status).toBe(200);
    const upd = c.calls.find((x) => /UPDATE task\.task/i.test(x.sql))!;
    expect(upd.sql).toMatch(/assignee = \$/);
    const outbox = c.calls.find((x) => /INSERT INTO shared\.outbox/i.test(x.sql) && (x.params as any[]).some((p) => typeof p === 'string' && p.includes('TaskAssigned')));
    expect(outbox).toBeTruthy();
  });
  it('invalid transition (resolved→open) → 422', async () => {
    const c = fakeClient('resolved', { task_id: 'task_1', status: 'resolved' });
    const res = await request(appWith(c)).patch('/v1/tasks/task_1').set('x-sim-tenant-id', 'tenant-dev').send({ status: 'open' });
    expect(res.status).toBe(422);
  });
  it('404 unknown task', async () => {
    const c = fakeClient('', null);
    const res = await request(appWith(c)).patch('/v1/tasks/nope').set('x-sim-tenant-id', 'tenant-dev').send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
  it('401 without tenant', async () => {
    const res = await request(appWith(fakeClient('open', {}))).patch('/v1/tasks/task_1').send({ status: 'resolved' });
    expect(res.status).toBe(401);
  });
});
