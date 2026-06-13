import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createFeedbackRouter } from '../routes/feedback.js';

function makePool(): Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
}

describe('POST /v1/assist/analyses/:id/feedback', () => {
  it('returns 204 and records feedback', async () => {
    const pool = makePool();
    const app = express();
    app.use(express.json());
    app.use(createFeedbackRouter(pool));

    const res = await request(app)
      .post('/v1/assist/analyses/ana_1/feedback')
      .set('x-sim-tenant-id', 't_test')
      .send({ items: [{ target: 'a1', action: 'accepted' }] });

    expect(res.status).toBe(204);
  });

  it('enqueues ai-ops review for hallucination_suspected override', async () => {
    const pool = makePool();
    const app = express();
    app.use(express.json());
    app.use(createFeedbackRouter(pool));

    await request(app)
      .post('/v1/assist/analyses/ana_1/feedback')
      .set('x-sim-tenant-id', 't_test')
      .send({ items: [{ target: 'a1', action: 'overridden', reason_code: 'hallucination_suspected' }] });

    const opsCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((args: unknown[]) => (args[0] as string).includes('sim.ai.ops-review'));
    expect(opsCall).toBeTruthy();
  });
});
