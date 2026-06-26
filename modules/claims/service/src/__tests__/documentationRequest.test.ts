import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildDocumentationRequestRouter } from '../routes/documentationRequest.js';

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  const client = {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [] })),
    release: vi.fn(),
  };
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildDocumentationRequestRouter(pool));
  return app;
}

describe('POST /:caseRef/documentation-request', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .send({ loinc_codes: ['11506-3'] });
    expect(res.status).toBe(401);
  });

  it('returns 400 when loinc_codes is missing or empty', async () => {
    const pool = makePool();
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/loinc_codes/);
  });

  it('returns 404 when claim is not found for the tenant', async () => {
    const pool = makePool([{ rows: [] }]); // UPDATE returns 0 rows
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3'] });
    expect(res.status).toBe(404);
  });

  it('returns 200 and emits outbox event on valid request', async () => {
    const pool = makePool([
      { rows: [{ claim_id: 'CLM_001', documentation_status: 'requested' }] }, // UPDATE RETURNING
    ]);
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3', '18842-5'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claim_id: 'CLM_001', documentation_status: 'requested' });
    // Verify outbox INSERT was called via pooled client
    expect(pool.connect).toHaveBeenCalled();
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes('shared.outbox'))).toBe(true);
  });
});
