import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createFeedbackRouter } from '../routes/feedback.js';

function makePool() {
  // The feedback writes + outbox now run through a withTenant transaction:
  // pool.connect() -> client.query (set_config, INSERTs, outbox appendEvent).
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  return { pool: pool as unknown as Pool, client };
}

describe('POST /v1/assist/analyses/:id/feedback', () => {
  it('returns 204 and records feedback inside a tenant transaction', async () => {
    const { pool, client } = makePool();
    const app = express();
    app.use(express.json());
    app.use(createFeedbackRouter(pool));

    const res = await request(app)
      .post('/v1/assist/analyses/ana_1/feedback')
      .set('x-sim-tenant-id', 't_test')
      .send({ items: [{ target: 'a1', action: 'accepted' }] });

    expect(res.status).toBe(204);

    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    const setConfigIdx = sqls.findIndex((s) => s.includes("set_config('sim.tenant_id'"));
    const feedbackIdx = sqls.findIndex((s) => s.includes('INSERT INTO revital.feedback'));
    const interactionIdx = sqls.findIndex((s) => s.includes('INSERT INTO shared.outbox'));
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(feedbackIdx).toBeGreaterThan(setConfigIdx); // tenant GUC set before the feedback write
    expect(interactionIdx).toBeGreaterThan(setConfigIdx);
    // Canonical envelope columns — never the phantom `payload` column.
    expect(sqls[interactionIdx]).toContain('(event_id, topic, key, envelope, tenant_id)');
    // No outbox write should land on the raw pool (would bypass the tenant GUC / RLS).
    const poolSqls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(poolSqls.some((s: string) => s.includes('shared.outbox'))).toBe(false);
  });

  it('enqueues ai-ops review for hallucination_suspected override', async () => {
    const { pool, client } = makePool();
    const app = express();
    app.use(express.json());
    app.use(createFeedbackRouter(pool));

    await request(app)
      .post('/v1/assist/analyses/ana_1/feedback')
      .set('x-sim-tenant-id', 't_test')
      .send({ items: [{ target: 'a1', action: 'overridden', reason_code: 'hallucination_suspected' }] });

    // Both the interaction and ops-review events are appended on the pooled client.
    const opsEvents = client.query.mock.calls
      .filter((args) => (args[0] as string).includes('INSERT INTO shared.outbox'))
      .map((args) => JSON.parse((args[1] as unknown[])[3] as string) as { topic?: string });
    // The envelope carries the topic via appendEvent; assert an ops-review event was emitted.
    const opsCall = client.query.mock.calls
      .filter((args) => (args[0] as string).includes('INSERT INTO shared.outbox'))
      .map((args) => (args[1] as unknown[])[1] as string) // topic column
      .find((topic) => topic === 'sim.ai.ops-review');
    expect(opsCall).toBe('sim.ai.ops-review');
    expect(opsEvents.length).toBe(2); // interaction + ops-review
  });
});
