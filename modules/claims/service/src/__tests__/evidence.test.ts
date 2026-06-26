import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { buildEvidenceRouter } from '../routes/evidence.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })),
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
    const pool = makePool([{ rows: [] }]);
    const res = await supertest(makeApp(pool))
      .get('/case-001/evidence')
      .set('x-sim-tenant-id', 'tenant-dev');
    expect(res.status).toBe(404);
  });

  it('returns evidence with null advisory when extraction not yet complete', async () => {
    const pool = makePool([
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'received',
          rfai_doc_id: 'doc-001',
        }],
      },
      { rows: [] }, // no advisory yet
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
  });

  it('returns evidence with advisory when extraction is complete', async () => {
    const pool = makePool([
      {
        rows: [{
          claim_id: 'CLM_001',
          documentation_status: 'extraction_complete',
          rfai_doc_id: 'doc-001',
        }],
      },
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
      },
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
  });
});
