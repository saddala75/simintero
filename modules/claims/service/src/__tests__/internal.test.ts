import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildInternalRouter } from '../routes/internal.js';

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
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
    const pool = makePool([{ rows: [{ claim_id: 'CLM_001' }] }]);
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
  });

  it('returns 404 when claim not found', async () => {
    const pool = makePool([{ rows: [] }]);
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
    const pool = makePool([{ rows: [{ claim_id: 'CLM_001' }] }]);
    const res = await supertest(makeApp(pool))
      .post('/v1/internal/attachment-rejected')
      .send({
        claim_id: 'CLM_001',
        tenant_id: 'tenant-dev',
        reason: 'SIG_INVALID',
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("documentation_status = 'rejected'"),
      expect.arrayContaining(['CLM_001', 'tenant-dev']),
    );
  });
});
