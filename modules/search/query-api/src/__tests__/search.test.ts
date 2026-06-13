import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createHash } from 'node:crypto';
import { buildSearchRouter } from '../routes/search.js';

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}

function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildSearchRouter(pool));
  return app;
}

describe('GET /v1/search', () => {
  // Test 1: missing x-sim-tenant-id header → 401
  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const pool = makePool();
    const app = makeApp(pool);

    const res = await supertest(app).get('/v1/search?q=case001');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing x-sim-tenant-id header' });
  });

  // Test 2: empty q param → 400
  it('returns 400 when q param is empty', async () => {
    const pool = makePool();
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/search?q=')
      .set('x-sim-tenant-id', 'tenant-abc');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or empty query parameter: q' });
  });

  // Test 3: valid request → 200 with results array and 64-char hex query_hash
  it('returns 200 with results array and query_hash as 64-char hex string', async () => {
    const pool = makePool([
      { rows: [{ entity_id: 'case_001', entity_type: 'case', indexed_at: '2026-01-01' }] },
      { rows: [] }, // search_log INSERT
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/search?q=case001')
      .set('x-sim-tenant-id', 'tenant-abc');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      entity_type: 'case',
      entity_id: 'case_001',
      metadata: {},
      score: 1.0,
    });
    expect(typeof res.body.query_hash).toBe('string');
    expect(res.body.query_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.total).toBe(1);
  });

  // Test 4: entity_types filter passes the parsed array as a parameter
  it('passes entity_types as an array parameter when entity_types=case is provided', async () => {
    const pool = makePool([
      { rows: [] }, // search query
      { rows: [] }, // search_log INSERT
    ]);
    const app = makeApp(pool);

    await supertest(app)
      .get('/v1/search?q=case001&entity_types=case')
      .set('x-sim-tenant-id', 'tenant-abc');

    // The first pool.query call is the SELECT; find it
    const calls = pool.query.mock.calls as Array<[string, unknown[]]>;
    const searchCall = calls.find(([sql]) => typeof sql === 'string' && sql.includes('index_event'));
    expect(searchCall).toBeDefined();
    const searchParams = searchCall![1];
    // The entity_types array should appear in the params
    expect(searchParams).toContainEqual(['case']);
  });

  // Test 5: query_hash equals sha256('case001')
  it('returns the correct SHA-256 hash of the query in query_hash', async () => {
    const pool = makePool([
      { rows: [{ entity_id: 'case_001', entity_type: 'case', indexed_at: '2026-01-01' }] },
      { rows: [] },
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/search?q=case001')
      .set('x-sim-tenant-id', 'tenant-abc');

    const expectedHash = createHash('sha256').update('case001').digest('hex');
    expect(res.body.query_hash).toBe(expectedHash);
  });

  // Test 6: missing q param entirely → 400
  it('returns 400 when q param is absent', async () => {
    const pool = makePool();
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/v1/search')
      .set('x-sim-tenant-id', 'tenant-abc');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or empty query parameter: q' });
  });

  // Test 7: limit is capped at 100 even if a higher value is provided
  it('caps limit at 100 regardless of the provided limit param', async () => {
    const pool = makePool([
      { rows: [] },
      { rows: [] },
    ]);
    const app = makeApp(pool);

    await supertest(app)
      .get('/v1/search?q=test&limit=500')
      .set('x-sim-tenant-id', 'tenant-abc');

    const calls = pool.query.mock.calls as Array<[string, unknown[]]>;
    const searchCall = calls.find(([sql]) => typeof sql === 'string' && sql.includes('index_event'));
    expect(searchCall).toBeDefined();
    const searchParams = searchCall![1];
    // The last param before LIMIT in the SQL is the capped limit value (100)
    const limitValue = searchParams[searchParams.length - 1];
    expect(limitValue).toBe(100);
  });
});
