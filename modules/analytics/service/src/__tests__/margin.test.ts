import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildMarginRouter } from '../routes/margin.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(buildMarginRouter(pool));
  return app;
}

describe('GET /v1/analytics/margin', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);

    const res = await supertest(app).get('/v1/analytics/margin');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Missing x-sim-tenant-id header' });
  });

  it('returns 200 with empty snapshots when pool returns no rows', async () => {
    const pool = makePool([{ rows: [] }]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/analytics/margin')
      .set('x-sim-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshots: [], count: 0 });
  });

  it('returns 200 with parsed numeric fields when one row is returned', async () => {
    const mockRow = {
      snapshot_id: 'snap-001',
      tenant_id: 'tenant-abc',
      period_start: '2025-01-01',
      period_end: '2025-01-31',
      revenue_usd: '10000.0000',
      cost_usd: '7500.0000',
      margin_usd: '2500.0000',
      computed_at: '2025-02-01T00:00:00.000Z',
    };

    const pool = makePool([{ rows: [mockRow] }]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/analytics/margin')
      .set('x-sim-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.snapshots).toHaveLength(1);

    const snap = res.body.snapshots[0];
    expect(snap.snapshot_id).toBe('snap-001');
    expect(snap.tenant_id).toBe('tenant-abc');
    // Verify numeric fields are parsed as numbers, not strings
    expect(typeof snap.revenue_usd).toBe('number');
    expect(typeof snap.cost_usd).toBe('number');
    expect(typeof snap.margin_usd).toBe('number');
    expect(snap.revenue_usd).toBe(10000);
    expect(snap.cost_usd).toBe(7500);
    expect(snap.margin_usd).toBe(2500);
  });
});

describe('GET /v1/analytics/platform-summary', () => {
  it('returns 200 with summary null when no rows exist', async () => {
    const pool = makePool([{ rows: [] }]);
    const app = makeApp(pool);

    const res = await supertest(app).get('/v1/analytics/platform-summary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: null });
  });

  it('returns 200 with summary object and parsed total_cost_usd when one row exists', async () => {
    const mockRow = {
      aggregate_id: 'agg-001',
      period_start: '2025-01-01',
      period_end: '2025-01-31',
      tenant_count: 42,
      case_count: 1234,
      gap_count: 567,
      total_cost_usd: '98765.1234',
      computed_at: '2025-02-01T00:00:00.000Z',
    };

    const pool = makePool([{ rows: [mockRow] }]);
    const app = makeApp(pool);

    const res = await supertest(app).get('/v1/analytics/platform-summary');

    expect(res.status).toBe(200);
    expect(res.body.summary).not.toBeNull();

    const summary = res.body.summary;
    expect(summary.aggregate_id).toBe('agg-001');
    expect(summary.tenant_count).toBe(42);
    expect(summary.case_count).toBe(1234);
    expect(summary.gap_count).toBe(567);
    // Verify total_cost_usd is parsed as a number
    expect(typeof summary.total_cost_usd).toBe('number');
    expect(summary.total_cost_usd).toBeCloseTo(98765.1234, 4);
  });
});
