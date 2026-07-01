import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildInternalRouter } from '../routes/internal.js';

/**
 * All DB queries now go through withTenant (pool.connect -> client.query).
 * pool.query is never called directly in this route.
 */
function makePool(clientResponses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  const client = {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(clientResponses[i++] ?? { rows: [] }),
    ),
    release: vi.fn(),
  };
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/v1/internal', buildInternalRouter(pool));
  return app;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ analysis_id: 'ana_001', operation: '/v1/operations/ana_001' }),
    status: 202,
  })));
});

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/internal/attachment-received', () => {
  it('returns 400 when required fields are missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({ claim_id: 'CLM_001' }); // missing case_ref, doc_id, tenant_id
    expect(res.status).toBe(400);
  });

  it('updates documentation_status to received and triggers Revital', async () => {
    // client.query sequence: BEGIN, set_config, UPDATE RETURNING, COMMIT
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ claim_id: 'CLM_001' }] }, // UPDATE RETURNING
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({
        claim_id: 'CLM_001',
        case_ref: 'case-uuid-001',
        doc_id: 'doc-uuid-001',
        tenant_id: 'tenant-dev',
        loinc_codes: ['11506-3'],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Verify fetch was called to Revital
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/v1/assist/analyses'),
      expect.objectContaining({ method: 'POST' }),
    );
    // Verify withTenant was used
    expect(pool.connect).toHaveBeenCalled();
    // Verify tenant GUC was set and UPDATE went through client
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes("set_config('sim.tenant_id'"))).toBe(true);
    expect(sqls.some((s: string) => s.includes("documentation_status = 'received'"))).toBe(true);
  });

  it('returns 404 when claim not found', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [] }, // UPDATE RETURNING → 0 rows
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-received')
      .send({
        claim_id: 'CLM_MISSING',
        case_ref: 'case-uuid-001',
        doc_id: 'doc-uuid-001',
        tenant_id: 'tenant-dev',
        loinc_codes: ['11506-3'],
      });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/internal/attachment-rejected', () => {
  it('returns 400 when required fields are missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-rejected')
      .send({ claim_id: 'CLM_001' }); // missing tenant_id, reason
    expect(res.status).toBe(400);
  });

  it('updates documentation_status to rejected', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ claim_id: 'CLM_001' }] }, // UPDATE RETURNING
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-rejected')
      .send({
        claim_id: 'CLM_001',
        tenant_id: 'tenant-dev',
        reason: 'SIG_INVALID',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.connect).toHaveBeenCalled();
    // Verify tenant GUC and rejected status update went through client
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes("documentation_status = 'rejected'"))).toBe(true);
    expect(sqls.some((s: string) => s.includes("set_config('sim.tenant_id'"))).toBe(true);
  });
});

describe('POST /v1/internal/pa-denial', () => {
  it('returns 400 when required fields are missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/pa-denial')
      .send({ case_id: 'some-uuid' }); // missing outcome, tenant_id
    expect(res.status).toBe(400);
  });

  it('updates pa_decision and pa_denied_at on the claim row', async () => {
    // client.query sequence: BEGIN, set_config, UPDATE RETURNING, COMMIT
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ claim_id: 'CLM_002' }] }, // UPDATE RETURNING
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/pa-denial')
      .send({
        case_id: 'case-uuid-002',
        outcome: 'denied',
        reason: 'conservative therapy not documented',
        tenant_id: 'tenant-dev',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Verify withTenant was used (RLS GUC set)
    expect(pool.connect).toHaveBeenCalled();
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes("set_config('sim.tenant_id'"))).toBe(true);
    // Verify the UPDATE sets pa_decision and pa_denied_at
    expect(sqls.some((s: string) => s.includes('pa_decision'))).toBe(true);
    expect(sqls.some((s: string) => s.includes('pa_denied_at'))).toBe(true);
  });

  it('returns 404 when no claim exists for the given case_id', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [] }, // UPDATE RETURNING → 0 rows (no claim linked to this case)
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/pa-denial')
      .send({
        case_id: 'case-uuid-missing',
        outcome: 'denied',
        tenant_id: 'tenant-dev',
      });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('No claim') });
  });
});
