import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createMeasuresRouter } from '../routes/measures.js';
import { createGapsRouter } from '../routes/gaps.js';

function makePool(rows: unknown[] = []): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

// ─── Measures: list runs ───────────────────────────────────────────────────

describe('GET /v1/quality/measures', () => {
  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const app = express();
    app.use(createMeasuresRouter(makePool()));

    const res = await request(app).get('/v1/quality/measures');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
  });

  it('returns 200 with { runs: [] } when query returns no rows', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('returns 200 with runs from the database', async () => {
    const run = {
      run_id: 'run_01',
      measure_ref: 'BCS',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      status: 'completed',
      started_at: '2024-12-01T00:00:00Z',
      completed_at: '2024-12-01T01:00:00Z',
    };
    const pool = makePool([run]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({ run_id: 'run_01', measure_ref: 'BCS' });
  });
});

// ─── Measures: performance ────────────────────────────────────────────────

describe('GET /v1/quality/measures/performance', () => {
  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const app = express();
    app.use(createMeasuresRouter(makePool()));

    const res = await request(app).get('/v1/quality/measures/performance');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
  });

  it('returns 200 with an array when qual.measure_run has completed rows', async () => {
    const row = {
      id: 'run-uuid',
      code: 'hedis-col',
      name: 'hedis-col',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      status: 'completed',
      numerator: '864',
      denominator: '1200',
      score: '0.72',
    };
    const pool = makePool([row]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/performance')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'run-uuid',
      code: 'hedis-col',
      program: 'HEDIS',
      score: 0.72,
      target: 0,
      trend: 0,
      numerator: 864,
      denominator: 1200,
    });
  });

  it('returns 200 with an empty array when there are no completed runs', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/performance')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('derives program from the measure_ref prefix correctly', async () => {
    const row = {
      id: 'run-stars',
      code: 'stars-d12',
      name: 'stars-d12',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      status: 'completed',
      numerator: '400',
      denominator: '500',
      score: '0.80',
    };
    const pool = makePool([row]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/performance')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body[0].program).toBe('STARS');
  });
});

// ─── Measures: run summary ─────────────────────────────────────────────────

describe('GET /v1/quality/measures/:runId/summary', () => {
  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const app = express();
    app.use(createMeasuresRouter(makePool()));

    const res = await request(app).get('/v1/quality/measures/run_01/summary');

    expect(res.status).toBe(401);
  });

  it('returns 200 with correct summary fields and rate calculation', async () => {
    const pool = makePool();
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{ denominator_count: '10', numerator_count: '7', exclusion_count: '1' }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/run_01/summary')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      run_id: 'run_01',
      denominator_count: 10,
      numerator_count: 7,
      exclusion_count: 1,
      gap_count: 3,
      rate: 0.7,
    });
  });

  it('returns rate of 0 when denominator_count is 0', async () => {
    const pool = makePool();
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{ denominator_count: '0', numerator_count: '0', exclusion_count: '0' }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/run_zero/summary')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(0);
    expect(res.body.denominator_count).toBe(0);
  });
});

// ─── Measures: member drill-down ───────────────────────────────────────────

describe('GET /v1/quality/measures/:runId/members', () => {
  it('returns 200 with member list and page number', async () => {
    const member = {
      report_id: 'rpt_01',
      member_id: 'mem_01',
      numerator: true,
      denominator: true,
      exclusion: false,
      created_at: '2024-12-01T00:00:00Z',
    };
    const pool = makePool([member]);
    const app = express();
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .get('/v1/quality/measures/run_01/members?page=0')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.page).toBe(0);
  });

  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createMeasuresRouter(makePool()));

    const res = await request(app).get('/v1/quality/measures/run_01/members');

    expect(res.status).toBe(401);
  });
});

// ─── Gaps: list ───────────────────────────────────────────────────────────

describe('GET /v1/quality/gaps', () => {
  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createGapsRouter(makePool()));

    const res = await request(app).get('/v1/quality/gaps');

    expect(res.status).toBe(401);
  });

  it('returns 200 with gap list', async () => {
    const gap = {
      gap_id: 'gap_01',
      member_id: 'mem_01',
      measure_ref: 'BCS',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      gap_type: 'missing_claim',
      status: 'open',
      detected_at: '2024-06-01T00:00:00Z',
      closed_at: null,
      closure_reason: null,
    };
    const pool = makePool([gap]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.gaps).toHaveLength(1);
    expect(res.body.gaps[0]).toMatchObject({ gap_id: 'gap_01', status: 'open' });
  });

  it('includes status filter in query when ?status=open is passed', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps?status=open')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);

    const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    const [sql, params] = queryCall;
    expect(sql).toContain('g.status');
    expect(params).toContain('open');
  });

  it('applies member_id and measure_ref filters when provided', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(createGapsRouter(pool));

    await request(app)
      .get('/v1/quality/gaps?member_id=mem_01&measure_ref=BCS')
      .set('x-sim-tenant-id', 'tenant_abc');

    const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    const [sql, params] = queryCall;
    expect(sql).toContain('g.member_id');
    expect(sql).toContain('g.measure_ref');
    expect(params).toContain('mem_01');
    expect(params).toContain('BCS');
  });
});

// ─── Gaps: summary ────────────────────────────────────────────────────────

describe('GET /v1/quality/gaps/summary', () => {
  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createGapsRouter(makePool()));

    const res = await request(app).get('/v1/quality/gaps/summary');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
  });

  it('returns 200 with grouped rows and computed opportunityScore', async () => {
    const row = {
      id: 'hedis-col',
      measureCode: 'hedis-col',
      measureName: 'hedis-col',
      provider: 'Valley Health',
      memberCount: '500',
      population: '1000',
      status: 'open',
    };
    const pool = makePool([row]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps/summary')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'hedis-col',
      measureCode: 'hedis-col',
      provider: 'Valley Health',
      memberCount: 500,
      population: 1000,
      opportunityScore: 50,
      status: 'open',
    });
  });

  it('sets opportunityScore to 100 when population is 0 (guards against div-by-zero)', async () => {
    const row = {
      id: 'hedis-bcs',
      measureCode: 'hedis-bcs',
      measureName: 'hedis-bcs',
      provider: null,
      memberCount: '1',
      population: '0',
      status: 'open',
    };
    const pool = makePool([row]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps/summary')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body[0].opportunityScore).toBe(100);
    expect(res.body[0].provider).toBe('');
  });
});

// ─── Gaps: summary member list ────────────────────────────────────────────

describe('GET /v1/quality/gaps/summary/:measureRef/members', () => {
  it('returns 200 with member list', async () => {
    const member = {
      gapId: 'gap_01',
      memberId: 'mem_01',
      status: 'open',
    };
    const pool = makePool([member]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps/summary/hedis-col/members')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ gapId: 'gap_01', memberId: 'mem_01', status: 'open' });
  });

  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createGapsRouter(makePool()));

    const res = await request(app).get('/v1/quality/gaps/summary/hedis-col/members');

    expect(res.status).toBe(401);
  });
});

// ─── Gaps: close member gap ───────────────────────────────────────────────

describe('POST /v1/quality/gaps/summary/:measureRef/members/:memberId/close', () => {
  it('returns 200 with { ok: true } when gap is closed', async () => {
    const pool = makePool([{ gap_id: 'gap_01' }]);
    const app = express();
    app.use(express.json());
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .post('/v1/quality/gaps/summary/hedis-col/members/mem_01/close')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send({ reason: 'care delivered' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 404 when no open gap matches', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(express.json());
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .post('/v1/quality/gaps/summary/hedis-col/members/mem_99/close')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('GAP_NOT_FOUND');
  });

  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(express.json());
    app.use(createGapsRouter(makePool()));

    const res = await request(app).post(
      '/v1/quality/gaps/summary/hedis-col/members/mem_01/close',
    );

    expect(res.status).toBe(401);
  });
});

// ─── Gaps: readiness ──────────────────────────────────────────────────────

describe('GET /v1/quality/readiness', () => {
  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createGapsRouter(makePool()));

    const res = await request(app).get('/v1/quality/readiness');

    expect(res.status).toBe(401);
  });

  it('returns 200 with status=passed when run completed and no open gaps', async () => {
    const row = { measure_ref: 'hedis-col', run_status: 'completed', open_gaps: '0' };
    const pool = makePool([row]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/readiness')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ measureRef: 'hedis-col', status: 'passed', flags: 0 });
  });

  it('returns status=warning when there are open gaps', async () => {
    const row = { measure_ref: 'hedis-bcs', run_status: 'completed', open_gaps: '5' };
    const pool = makePool([row]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/readiness')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ measureRef: 'hedis-bcs', status: 'warning', flags: 5 });
  });

  it('returns status=pending when run has not completed and no open gaps', async () => {
    const row = { measure_ref: 'hedis-a1c', run_status: null, open_gaps: '0' };
    const pool = makePool([row]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/readiness')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ measureRef: 'hedis-a1c', status: 'pending', flags: 0 });
  });
});

// ─── Measures: submission lock ────────────────────────────────────────────

describe('POST /v1/quality/submission-lock', () => {
  it('returns 201 with lockId, packageId, lockedAt', async () => {
    const lockRow = {
      lock_id: 'lock-uuid-01',
      package_id: 'pkg-uuid-01',
      locked_at: '2026-07-01T00:00:00Z',
    };
    const pool = makePool([lockRow]);
    const app = express();
    app.use(express.json());
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .post('/v1/quality/submission-lock')
      .set('x-sim-tenant-id', 'tenant_abc')
      .set('x-sim-user-id', 'user_01');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      lockId: 'lock-uuid-01',
      packageId: 'pkg-uuid-01',
      lockedAt: '2026-07-01T00:00:00Z',
    });
  });

  it('defaults locked_by to system when x-sim-user-id header is absent', async () => {
    const lockRow = {
      lock_id: 'lock-uuid-02',
      package_id: 'pkg-uuid-02',
      locked_at: '2026-07-01T00:00:00Z',
    };
    const pool = makePool([lockRow]);
    const app = express();
    app.use(express.json());
    app.use(createMeasuresRouter(pool));

    const res = await request(app)
      .post('/v1/quality/submission-lock')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(201);
    const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown[],
    ];
    const [, params] = queryCall;
    expect(params[1]).toBe('system');
  });

  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(express.json());
    app.use(createMeasuresRouter(makePool()));

    const res = await request(app).post('/v1/quality/submission-lock');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TENANT_ID');
  });
});

// ─── Gaps: single gap ─────────────────────────────────────────────────────

describe('GET /v1/quality/gaps/:gapId', () => {
  it('returns 404 when gap is not found', async () => {
    const pool = makePool([]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps/gap_nonexistent')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('GAP_NOT_FOUND');
  });

  it('returns 200 with gap detail including nullable task_id', async () => {
    const gap = {
      gap_id: 'gap_01',
      member_id: 'mem_01',
      measure_ref: 'BCS',
      period_start: '2024-01-01',
      period_end: '2024-12-31',
      gap_type: 'missing_claim',
      status: 'open',
      detected_at: '2024-06-01T00:00:00Z',
      closed_at: null,
      closure_reason: null,
      task_id: 'task_01',
    };
    const pool = makePool([gap]);
    const app = express();
    app.use(createGapsRouter(pool));

    const res = await request(app)
      .get('/v1/quality/gaps/gap_01')
      .set('x-sim-tenant-id', 'tenant_abc');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gap_id: 'gap_01', task_id: 'task_01' });
  });

  it('returns 401 when tenant header is absent', async () => {
    const app = express();
    app.use(createGapsRouter(makePool()));

    const res = await request(app).get('/v1/quality/gaps/gap_01');

    expect(res.status).toBe(401);
  });
});
