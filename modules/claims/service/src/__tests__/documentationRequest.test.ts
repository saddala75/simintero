import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildDocumentationRequestRouter } from '../routes/documentationRequest.js';

/**
 * All queries now go through withTenant (pool.connect -> client.query).
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
    // pool.query is not used by this route after the fix
    query: vi.fn().mockResolvedValue({ rows: [] }),
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
    // withTenant calls BEGIN, set_config, UPDATE (returns 0 rows), COMMIT via client.query.
    // The first substantive response (after BEGIN and set_config preamble) is the UPDATE.
    // makePool responses [0]=BEGIN, [1]=set_config, [2]=UPDATE→0 rows, [3]=COMMIT.
    // But client.query mock returns clientResponses[i++], and BEGIN/set_config don't need
    // real rows; the UPDATE returning [] triggers the 404 path.
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [] }, // UPDATE RETURNING → 0 rows → triggers null return
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3'] });
    expect(res.status).toBe(404);
  });

  it('returns 200 and emits outbox event on valid request', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [{ claim_id: 'CLM_001', documentation_status: 'requested' }] }, // UPDATE RETURNING
      { rows: [] }, // outbox INSERT
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/case-001/documentation-request')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({ loinc_codes: ['11506-3', '18842-5'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claim_id: 'CLM_001', documentation_status: 'requested' });
    // Verify withTenant was used: pool.connect must be called
    expect(pool.connect).toHaveBeenCalled();
    // Verify outbox INSERT went through the client
    const sqls = pool._client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sqls.some((s: string) => s.includes('shared.outbox'))).toBe(true);
    // Verify tenant GUC was set before the UPDATE
    const setConfigIdx = sqls.findIndex((s: string) => s.includes("set_config('sim.tenant_id'"));
    const updateIdx = sqls.findIndex((s: string) => s.includes('UPDATE claims.claim'));
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(setConfigIdx);
  });
});
