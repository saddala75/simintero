import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildClaimsRouter } from '../routes/claims.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildClaimsRouter(pool));
  return app;
}

describe('POST / (create claim)', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).post('/').send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('x-sim-tenant-id') });
  });

  it('returns 400 when claim_number is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ service_date_start: '2024-01-01', service_date_end: '2024-01-10', total_billed_usd: '500.00' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('claim_number') });
  });

  it('returns 400 when service_date_start is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ claim_number: 'CLM-001', service_date_end: '2024-01-10', total_billed_usd: '500.00' });
    expect(res.status).toBe(400);
  });

  it('returns 201 with case_ref and claim_id on valid request', async () => {
    const pool = makePool([
      { rows: [{ case_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] }, // ens.case INSERT
      { rows: [] }, // claims.claim INSERT
      { rows: [] }, // outbox INSERT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({
        claim_number: 'CLM-001',
        service_date_start: '2024-01-01',
        service_date_end: '2024-01-10',
        total_billed_usd: '1500.00',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('case_ref', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(res.body).toHaveProperty('claim_id');
    expect(typeof res.body.claim_id).toBe('string');
  });

  it('calls pool.query 3 times on valid request (ens.case, claims.claim, outbox)', async () => {
    const pool = makePool([
      { rows: [{ case_id: 'test-uuid-1234' }] },
      { rows: [] },
      { rows: [] },
    ]);
    await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-abc')
      .send({
        claim_number: 'CLM-002',
        service_date_start: '2024-02-01',
        service_date_end: '2024-02-15',
        total_billed_usd: '2500.75',
      });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});

describe('GET /:caseRef (get claim)', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).get('/some-uuid');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('x-sim-tenant-id') });
  });

  it('returns 404 when claim case not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const res = await supertest(makeApp(pool))
      .get('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .set('x-sim-tenant-id', 'tenant-1');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('not found') });
  });

  it('returns 200 with claim data including claim_number and total_billed_usd as number', async () => {
    const pool = makePool([
      {
        rows: [{
          case_ref: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          case_type: 'claim',
          state: 'intake',
          created_at: '2024-01-01T00:00:00Z',
          claim_id: 'CLM_ID_001',
          claim_number: 'CLM-001',
          service_date_start: '2024-01-01',
          service_date_end: '2024-01-10',
          total_billed_usd: '1500.0000',
          claim_status: 'submitted',
        }],
      },
    ]);
    const res = await supertest(makeApp(pool))
      .get('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .set('x-sim-tenant-id', 'tenant-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('claim_number', 'CLM-001');
    expect(res.body).toHaveProperty('total_billed_usd', 1500.0);
    expect(typeof res.body.total_billed_usd).toBe('number');
  });
});
