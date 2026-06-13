import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { iroRoutingWorkflow } from '../workflows/IRORoutingWorkflow.js';
import { buildIRORouter } from '../routes/iro.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}
function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildIRORouter(pool));
  return app;
}

describe('iroRoutingWorkflow', () => {
  it('emits IRO referral outbox event with IDs only (no clinical content)', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }]);
    await iroRoutingWorkflow('appeal-uuid', 't1', pool);

    expect(pool.query).toHaveBeenCalledTimes(2);

    const firstCallSql = pool.query.mock.calls[0][0] as string;
    expect(firstCallSql).toContain('sim.claims.iro');

    const payloadJson = pool.query.mock.calls[0][1][1] as string;
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    expect(payload['event_type']).toBe('IROReferred');
    expect(payload['appeal_case_ref']).toBe('appeal-uuid');

    // No clinical content — only allowed keys
    const allowedKeys = new Set(['event_type', 'appeal_case_ref', 'iro_vendor_id']);
    for (const key of Object.keys(payload)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('updates ens.case state to IRO_PENDING', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }]);
    await iroRoutingWorkflow('appeal-uuid', 't1', pool);

    const secondCallSql = pool.query.mock.calls[1][0] as string;
    expect(secondCallSql).toContain('IRO_PENDING');

    const secondCallParams = pool.query.mock.calls[1][1] as unknown[];
    expect(secondCallParams).toContain('appeal-uuid');
  });

  it('uses IRO_VENDOR_ID from process.env when set', async () => {
    // The workflow reads the env var lazily at call time, so setting it before calling works
    process.env['IRO_VENDOR_ID'] = 'test-iro';
    try {
      const pool = makePool([{ rows: [] }, { rows: [] }]);
      await iroRoutingWorkflow('appeal-uuid', 't1', pool);

      const payloadJson = pool.query.mock.calls[0][1][1] as string;
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      expect(payload['iro_vendor_id']).toBe('test-iro');
    } finally {
      delete process.env['IRO_VENDOR_ID'];
    }
  });
});

describe('IRO webhook — POST /decision', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).post('/decision').send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('x-sim-tenant-id') });
  });

  it('returns 400 when decision is partial_deny (not allowed)', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/decision')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ iro_vendor_id: 'iro-1', appeal_case_ref: 'uuid-1', decision: 'partial_deny' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('decision') });
  });

  it('returns 200 with new_state OVERTURNED when decision is overturn', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }]);
    const res = await supertest(makeApp(pool))
      .post('/decision')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ iro_vendor_id: 'iro-1', appeal_case_ref: 'uuid-1', decision: 'overturn' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appeal_case_ref: 'uuid-1',
      decision: 'overturn',
      new_state: 'OVERTURNED',
    });
  });
});
