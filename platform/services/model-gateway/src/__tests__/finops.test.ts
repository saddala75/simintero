import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { createFinopsRouter } from '../routes/finops.js';

function makeApp(pool: pg.Pool) {
  const app = express();
  app.use(express.json());
  app.use(createFinopsRouter(pool));
  return app;
}

function makePool(rows: object[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as pg.Pool;
}

describe('GET /v1/finops/cost-summary', () => {
  it('returns 401 when x-sim-tenant-id absent', async () => {
    const app = makeApp(makePool());
    const res = await request(app).get('/v1/finops/cost-summary?period_start=2026-01-01&period_end=2026-12-31');
    expect(res.status).toBe(401);
  });

  it('returns 400 when period_start absent', async () => {
    const app = makeApp(makePool());
    const res = await request(app)
      .get('/v1/finops/cost-summary?period_end=2026-12-31')
      .set('x-sim-tenant-id', 't1');
    expect(res.status).toBe(400);
  });

  it('returns 200 with aggregated cost summary', async () => {
    const pool = makePool([
      { module: 'revital', total_usd: '1.23', inference_count: '5', avg_latency_ms: '450.5' },
    ]);
    const app = makeApp(pool);
    const res = await request(app)
      .get('/v1/finops/cost-summary?period_start=2026-01-01&period_end=2026-12-31')
      .set('x-sim-tenant-id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.summary[0].module).toBe('revital');
    expect(res.body.summary[0].total_usd).toBeCloseTo(1.23);
    expect(res.body.summary[0].inference_count).toBe(5);
  });

  it('returns empty summary when no inference in period', async () => {
    const app = makeApp(makePool([]));
    const res = await request(app)
      .get('/v1/finops/cost-summary?period_start=2026-01-01&period_end=2026-12-31')
      .set('x-sim-tenant-id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual([]);
  });
});

describe('GET /v1/finops/cost-by-model', () => {
  it('returns 200 grouped by model_binding_ref', async () => {
    const pool = makePool([
      { model_binding_ref: 'claude-sonnet-4', total_usd: '2.50', inference_count: '10', avg_latency_ms: '320' },
    ]);
    const app = makeApp(pool);
    const res = await request(app)
      .get('/v1/finops/cost-by-model?period_start=2026-01-01&period_end=2026-12-31')
      .set('x-sim-tenant-id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.by_model[0].model_binding_ref).toBe('claude-sonnet-4');
  });
});
