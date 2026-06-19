import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTaskRouter } from '../router.js';

function mockClient() {
  const calls: { sql: string; params?: any[] | undefined }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: any[]) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }),
    release: vi.fn(),
  };
}
function appWith(client: any) {
  const app = express(); app.use(express.json());
  app.locals['pool'] = { connect: async () => client };
  app.use(createTaskRouter());
  return app;
}

describe('POST /v1/tasks', () => {
  it('creates a task (open) + emits TaskCreated, in a tenant tx', async () => {
    const c = mockClient();
    const res = await request(appWith(c)).post('/v1/tasks')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ task_kind: 'quality-outreach', payload: { gap_id: 'g1' }, created_by: 'qualitron' });
    expect(res.status).toBe(201);
    expect(res.body.task_id).toMatch(/^task_/);
    expect(res.body.status).toBe('open');
    const sqls = c.calls.map((x) => x.sql);
    expect(sqls.some((s) => /set_config\('sim\.tenant_id'/.test(s))).toBe(true);          // tenant GUC set
    expect(sqls.some((s) => /INSERT INTO task\.task/i.test(s))).toBe(true);                // task inserted
    expect(sqls.some((s) => /INSERT INTO shared\.outbox/i.test(s))).toBe(true);            // TaskCreated event
    // the outbox envelope carries the TaskCreated schema_ref
    const outboxCall = c.calls.find((x) => /INSERT INTO shared\.outbox/i.test(x.sql))!;
    const env = JSON.parse((outboxCall.params as any[]).find((p) => typeof p === 'string' && p.includes('schema_ref')));
    expect(env.schema_ref).toBe('sim.task.lifecycle/TaskCreated/v1');
  });
  it('401 without tenant header', async () => {
    const res = await request(appWith(mockClient())).post('/v1/tasks').send({ task_kind: 'x' });
    expect(res.status).toBe(401);
  });
  it('400 without task_kind', async () => {
    const res = await request(appWith(mockClient())).post('/v1/tasks').set('x-sim-tenant-id', 't').send({});
    expect(res.status).toBe(400);
  });
});
