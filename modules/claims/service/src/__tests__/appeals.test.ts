import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildAppealsRouter } from '../routes/appeals.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildAppealsRouter(pool));
  return app;
}

describe('POST / (create appeal)', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).post('/').send({});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('x-sim-tenant-id') });
  });

  it('returns 400 when original_case_ref is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ appeal_type: 'standard' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('original_case_ref') });
  });

  it('returns 400 when appeal_type is invalid', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ original_case_ref: 'some-uuid', appeal_type: 'invalid_type' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('appeal_type') });
  });

  it('returns 400 when appeal_type is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ original_case_ref: 'some-uuid' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('appeal_type') });
  });

  it('returns 404 when original case not found (empty rows from validation query)', async () => {
    const pool = makePool([{ rows: [] }]); // validation query returns empty
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ original_case_ref: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', appeal_type: 'standard' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('not found') });
  });

  it('returns 201 with case_ref, appeal_id, and original_case_ref on valid appeal_type=standard', async () => {
    const pool = makePool([
      { rows: [{ case_id: 'orig-case-uuid' }] },       // original case lookup
      { rows: [{ case_id: 'new-appeal-uuid' }] },       // ens.case INSERT
      { rows: [] },                                       // claims.appeal INSERT
      { rows: [] },                                       // outbox INSERT
    ]);
    const res = await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ original_case_ref: 'orig-case-uuid', appeal_type: 'standard' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('case_ref', 'new-appeal-uuid');
    expect(res.body).toHaveProperty('appeal_id');
    expect(typeof res.body.appeal_id).toBe('string');
    expect(res.body).toHaveProperty('original_case_ref', 'orig-case-uuid');
  });

  it('calls pool.query 4 times on valid appeal creation', async () => {
    const pool = makePool([
      { rows: [{ case_id: 'orig-case-uuid' }] },
      { rows: [{ case_id: 'new-appeal-uuid' }] },
      { rows: [] },
      { rows: [] },
    ]);
    await supertest(makeApp(pool))
      .post('/')
      .set('x-sim-tenant-id', 'tenant-1')
      .send({ original_case_ref: 'orig-case-uuid', appeal_type: 'expedited' });
    expect(pool.query).toHaveBeenCalledTimes(4);
  });
});

describe('GET /:appealCaseRef (get appeal)', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).get('/some-appeal-uuid');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining('x-sim-tenant-id') });
  });

  it('returns 404 when appeal not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const res = await supertest(makeApp(pool))
      .get('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      .set('x-sim-tenant-id', 'tenant-1');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining('not found') });
  });

  it('returns 200 with appeal data including original_case_ref', async () => {
    const pool = makePool([
      {
        rows: [{
          appeal_case_ref: 'new-appeal-uuid',
          case_type: 'appeal',
          state: 'intake',
          appeal_id: 'APPEAL_ID_001',
          appeal_type: 'standard',
          original_case_ref: 'orig-case-uuid',
          filed_at: null,
        }],
      },
    ]);
    const res = await supertest(makeApp(pool))
      .get('/new-appeal-uuid')
      .set('x-sim-tenant-id', 'tenant-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('original_case_ref', 'orig-case-uuid');
    expect(res.body).toHaveProperty('appeal_id', 'APPEAL_ID_001');
    expect(res.body).toHaveProperty('appeal_type', 'standard');
  });
});
