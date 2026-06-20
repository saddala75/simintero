import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildBundlesRouter } from '../routes/bundles.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  // Outbox writes now go through a withTenant transaction: pool.connect() -> client.query.
  const client = {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [] })),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
    connect: vi.fn().mockImplementation(() => Promise.resolve(client)),
  } as any;
  pool.client = client;
  return pool;
}
function makeApp(pool: ReturnType<typeof makePool>) {
  const app = express();
  app.use(express.json());
  app.use('/', buildBundlesRouter(pool as any));
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe('GET /:bundleRef', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);

    const res = await supertest(app).get('/ma-starter');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Missing x-sim-tenant-id header' });
  });

  it('returns 404 when bundle does not exist', async () => {
    const pool = makePool([{ rows: [] }]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/ma-starter')
      .set('x-sim-tenant-id', 'tenant-001');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Bundle not found' });
  });

  it('returns 200 with bundle data and artifacts when bundle exists', async () => {
    const bundleRow = {
      bundle_id: '01HZ001',
      bundle_ref: 'ma-starter',
      lob: 'MA',
      name: 'Medicare Advantage Starter Bundle',
      status: 'draft',
      version: 1,
      created_at: '2026-06-13T00:00:00.000Z',
    };
    const artifactRows = [
      { artifact_id: 'art-001', artifact_role: 'policy' },
      { artifact_id: 'art-002', artifact_role: 'clinical_criteria' },
    ];
    const pool = makePool([
      { rows: [bundleRow] },
      { rows: artifactRows },
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .get('/ma-starter')
      .set('x-sim-tenant-id', 'tenant-001');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bundle_id: '01HZ001',
      bundle_ref: 'ma-starter',
      lob: 'MA',
      name: 'Medicare Advantage Starter Bundle',
      status: 'draft',
    });
    expect(res.body.artifacts).toHaveLength(2);
    expect(res.body.artifacts[0]).toMatchObject({ artifact_id: 'art-001', artifact_role: 'policy' });
  });
});

describe('POST /:bundleRef/provision', () => {
  it('returns 401 when x-sim-tenant-id header is missing', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .send({ artifact_refs: [{ role: 'policy', ref: 'pa-standard-ma' }] });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Missing x-sim-tenant-id header' });
  });

  it('returns 400 when artifact_refs is missing from request body', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .set('x-sim-tenant-id', 'tenant-001')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'artifact_refs must be a non-empty array' });
  });

  it('returns 400 when artifact_refs is an empty array', async () => {
    const pool = makePool([]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .set('x-sim-tenant-id', 'tenant-001')
      .send({ artifact_refs: [] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'artifact_refs must be a non-empty array' });
  });

  it('returns 409 when bundle already exists for this tenant', async () => {
    const pool = makePool([
      { rows: [{ bundle_id: '01HZ_EXISTING' }] }, // existing check returns a row
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .set('x-sim-tenant-id', 'tenant-001')
      .send({ artifact_refs: [{ role: 'policy', ref: 'pa-standard-ma' }] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'Bundle already provisioned', bundle_ref: 'ma-starter' });
  });

  it('returns 201 with status=draft (NEVER active) and provisions bundle correctly', async () => {
    const pool = makePool([
      { rows: [] },                                  // existing check — not found
      { rows: [] },                                  // INSERT into market.bundle
      { rows: [{ artifact_id: 'art-001' }] },        // vkas lookup for first artifact
      { rows: [] },                                  // INSERT into market.bundle_artifact
      { rows: [{ artifact_id: 'art-002' }] },        // vkas lookup for second artifact
      { rows: [] },                                  // INSERT into market.bundle_artifact
      // outbox INSERT now goes via the pooled client (withTenant), not pool.query
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .set('x-sim-tenant-id', 'tenant-001')
      .send({
        artifact_refs: [
          { role: 'policy', ref: 'pa-standard-ma' },
          { role: 'clinical_criteria', ref: 'ma-clinical-criteria-v1' },
        ],
      });

    expect(res.status).toBe(201);

    // HUMAN_REVIEW security guard: status MUST be 'draft', NEVER 'active'
    expect(res.body.status).toBe('draft');
    expect(res.body.status).not.toBe('active');

    expect(res.body.lob).toBe('MA');
    expect(res.body.bundle_ref).toBe('ma-starter');
    expect(res.body.bundle_id).toBeDefined();

    // Outbox write goes through a tenant transaction with the canonical envelope.
    expect(pool.connect).toHaveBeenCalledTimes(1);
    const clientSqls = pool.client.query.mock.calls.map((c: unknown[]) => c[0] as string);
    const setConfigIdx = clientSqls.findIndex((s: string) => s.includes("set_config('sim.tenant_id'"));
    const insertIdx = clientSqls.findIndex((s: string) => s.includes('INSERT INTO shared.outbox'));
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(setConfigIdx);
    expect(clientSqls[insertIdx]).toContain('(event_id, topic, key, envelope, tenant_id)');
    const poolSqls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(poolSqls.some((s: string) => s.includes('shared.outbox'))).toBe(false);
  });

  it('skips missing artifacts gracefully and still provisions the bundle', async () => {
    const pool = makePool([
      { rows: [] },           // existing check — not found
      { rows: [] },           // INSERT into market.bundle
      { rows: [] },           // vkas lookup returns nothing — artifact missing
      // outbox INSERT now goes via the pooled client (withTenant), not pool.query
    ]);
    const app = makeApp(pool);

    const res = await supertest(app)
      .post('/ma-starter/provision')
      .set('x-sim-tenant-id', 'tenant-001')
      .send({
        artifact_refs: [{ role: 'policy', ref: 'pa-standard-ma' }],
      });

    expect(res.status).toBe(201);
    // HUMAN_REVIEW: even when artifacts are skipped, status remains 'draft'
    expect(res.body.status).toBe('draft');
    expect(res.body.status).not.toBe('active');
  });
});
