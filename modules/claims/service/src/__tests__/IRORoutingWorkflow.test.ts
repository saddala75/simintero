import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { iroRoutingWorkflow } from '../workflows/IRORoutingWorkflow.js';
import { buildIRORouter } from '../routes/iro.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  // Outbox writes now go through a withTenant transaction: pool.connect() -> client.query.
  const client = {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [] })),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
    connect: vi.fn().mockImplementation(() => Promise.resolve(client)),
  } as any;
  pool.client = client;
  return pool;
}

// Extract the domain payload from the canonical envelope written to the outbox on a pooled client.
function outboxEnvelope(pool: any): Record<string, unknown> {
  const call = pool.client.query.mock.calls.find(
    (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO shared.outbox'),
  );
  const params = call[1] as unknown[];
  // canonical params: [event_id, topic, key, envelope, tenant_id]
  const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
  return envelope['payload'] as Record<string, unknown>;
}
function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildIRORouter(pool));
  return app;
}

describe('iroRoutingWorkflow', () => {
  it('emits IRO referral outbox event with IDs only (no clinical content)', async () => {
    const pool = makePool([{ rows: [] }]);
    await iroRoutingWorkflow('appeal-uuid', 't1', pool);

    // Outbox INSERT now flows through a pooled client; the ens.case UPDATE stays on pool.query.
    const clientSqls = pool.client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const setConfigIdx = clientSqls.findIndex((s: string) => s.includes("set_config('sim.tenant_id'"));
    const insertIdx = clientSqls.findIndex((s: string) => s.includes('INSERT INTO shared.outbox'));
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(setConfigIdx); // tenant GUC set before the INSERT
    expect(clientSqls[insertIdx]).toContain('(event_id, topic, key, envelope, tenant_id)');

    const insertParams = pool.client.query.mock.calls[insertIdx][1] as unknown[];
    expect(insertParams[1]).toBe('sim.claims.iro'); // topic

    const payload = outboxEnvelope(pool);

    expect(payload['event_type']).toBe('IROReferred');
    expect(payload['appeal_case_ref']).toBe('appeal-uuid');

    // No clinical content — only allowed keys
    const allowedKeys = new Set(['event_type', 'appeal_case_ref', 'iro_vendor_id']);
    for (const key of Object.keys(payload)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('updates ens.case state to IRO_PENDING', async () => {
    const pool = makePool([{ rows: [] }]);
    await iroRoutingWorkflow('appeal-uuid', 't1', pool);

    const updateCall = pool.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('IRO_PENDING'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1] as unknown[]).toContain('appeal-uuid');
  });

  it('uses IRO_VENDOR_ID from process.env when set', async () => {
    // The workflow reads the env var lazily at call time, so setting it before calling works
    process.env['IRO_VENDOR_ID'] = 'test-iro';
    try {
      const pool = makePool([{ rows: [] }]);
      await iroRoutingWorkflow('appeal-uuid', 't1', pool);

      const payload = outboxEnvelope(pool);
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
