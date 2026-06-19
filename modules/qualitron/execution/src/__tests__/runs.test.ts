import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createRunsRouter } from '../routes/runs.js';

const VALID_RUN_BODY = {
  measure_ref: 'hedis:BCS-E',
  measure_version: '1.0.0',
  period_start: '2026-01-01',
  period_end: '2026-06-30',
};

function buildApp(pool: Pool, opts?: Parameters<typeof createRunsRouter>[1]) {
  const app = express();
  app.use(express.json());
  app.use(createRunsRouter(pool, opts));
  return app;
}

describe('POST /v1/quality/runs kicks off the measure run', () => {
  it('returns 202 + run_id and kicks off the runner (non-awaited)', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const runner = vi.fn().mockResolvedValue({ run_id: 'x', total: 0, failed: 0 });
    const app = buildApp({ query } as unknown as Pool, { runner });

    const res = await request(app)
      .post('/v1/quality/runs')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send(VALID_RUN_BODY);

    expect(res.status).toBe(202);
    expect(res.body.run_id).toBeTruthy();
    expect(res.body.status).toBe('accepted');

    // Let the non-awaited microtask settle, then assert the runner ran.
    await new Promise((r) => setImmediate(r));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toMatchObject({
      tenant_id: 'tenant-dev',
      measure_ref: 'hedis:BCS-E',
      measure_version: '1.0.0',
      period_start: '2026-01-01',
      period_end: '2026-06-30',
    });
    // run_id passed to the runner matches the one returned to the caller
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ run_id: res.body.run_id });
  });

  it('marks the run failed when the runner rejects', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const runner = vi.fn().mockRejectedValue(new Error('boom'));
    const app = buildApp({ query } as unknown as Pool, { runner });

    const res = await request(app)
      .post('/v1/quality/runs')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send(VALID_RUN_BODY);

    expect(res.status).toBe(202);

    // Wait for the rejection -> failed UPDATE to be issued.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const failUpdate = query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes("status='failed'") && c[0].includes('measure_run'),
    );
    expect(failUpdate).toBeTruthy();
    expect(failUpdate?.[1]).toEqual([res.body.run_id]);
  });

  it('returns 401 when x-sim-tenant-id header is absent (no runner kicked off)', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const runner = vi.fn();
    const app = buildApp({ query } as unknown as Pool, { runner });

    const res = await request(app).post('/v1/quality/runs').send(VALID_RUN_BODY);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
    expect(runner).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are absent (no runner kicked off)', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const runner = vi.fn();
    const app = buildApp({ query } as unknown as Pool, { runner });

    const { measure_ref: _omitted, ...bodyWithoutRef } = VALID_RUN_BODY;
    const res = await request(app)
      .post('/v1/quality/runs')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send(bodyWithoutRef);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
    expect(runner).not.toHaveBeenCalled();
  });
});
