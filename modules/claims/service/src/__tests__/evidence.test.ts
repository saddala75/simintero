import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildEvidenceRouter } from '../routes/evidence.js';

/**
 * All DB queries now go through withTenant (pool.connect -> client.query).
 * pool.query is never called directly in this route.
 */
function makePool(clientResponses: Array<{ rows: unknown[] }>) {
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
  app.use('/', buildEvidenceRouter(pool));
  return app;
}

describe('GET /:caseRef/evidence', () => {
  it('returns 401 when x-sim-tenant-id is missing', async () => {
    const pool = makePool([]);
    const res = await supertest(makeApp(pool)).get('/case-001/evidence');
    expect(res.status).toBe(401);
  });

  it('returns 404 when claim is not found', async () => {
    // client.query sequence: BEGIN, set_config, claim SELECT → 0 rows, COMMIT
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      { rows: [] }, // claim SELECT → 0 rows
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(404);
  });

  it('returns evidence with null advisory when extraction not yet complete', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'received',
          rfai_doc_id: 'doc-001',
        }],
      }, // claim SELECT
      { rows: [] }, // advisory SELECT → no rows
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      claim_id: 'CLM_001',
      documentation_status: 'received',
      rfai_doc_id: 'doc-001',
      advisory: null,
    });
    expect(pool.connect).toHaveBeenCalled();
  });

  it('returns evidence with advisory when extraction is complete', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // set_config
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'extraction_complete',
          rfai_doc_id: 'doc-001',
        }],
      }, // claim SELECT
      {
        rows: [{
          analysis_id: 'ana_001',
          advisory_type: 'claims_attachment',
          status: 'complete',
          summary: { text: 'Patient has knee pain' },
          extraction: { entities: [] },
          completeness: null,
          triage: null,
        }],
      }, // advisory SELECT
      { rows: [] }, // COMMIT
    ]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(200);
    expect(res.body.advisory).toMatchObject({
      analysis_id: 'ana_001',
      advisory_type: 'claims_attachment',
      status: 'complete',
    });
    expect(pool.connect).toHaveBeenCalled();
  });
});
