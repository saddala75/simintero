import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
import { fetch } from 'undici';

import { createRedactRouter } from '../routes/redact.js';

const FAKE_DOC_ID = '33333333-3333-3333-3333-333333333333';
const FAKE_VIEW_ID = '44444444-4444-4444-4444-444444444444';
const TENANT_ID = 't_test';
const USER_ID = 'u_test_reviewer';

function makeCleanDoc(): Pool {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          virus_scan_status: 'clean',
          text_key: `${TENANT_ID}/docs/${FAKE_DOC_ID}/text`,
          object_key: `${TENANT_ID}/docs/${FAKE_DOC_ID}/raw`,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ view_id: FAKE_VIEW_ID }],
      }),
  } as unknown as Pool;
}

function makeDocNotFound(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

function makeQuarantinedDoc(): Pool {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [{
        virus_scan_status: 'quarantined',
        text_key: null,
        object_key: `${TENANT_ID}/docs/${FAKE_DOC_ID}/raw`,
      }],
    }),
  } as unknown as Pool;
}

function makeStore(): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue(Buffer.from('Patient John Smith DOB 1985-01-15')),
    delete: vi.fn(),
  } as unknown as ObjectStore;
}

function armPresidioMock(): void {
  vi.mocked(fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { entity_type: 'PERSON', start: 8, end: 18, score: 0.95 },
        { entity_type: 'DATE_TIME', start: 23, end: 33, score: 0.88 },
      ],
    } as never)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: 'Patient [REDACTED:PERSON] DOB [REDACTED:DATE]',
        items: [
          { entity_type: 'PERSON', start: 8, end: 24 },
          { entity_type: 'DATE_TIME', start: 29, end: 43 },
        ],
      }),
    } as never);
}

describe('POST /documents/:docId/redact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 with no tenant header', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(makeCleanDoc(), makeStore()));

    const res = await request(app)
      .post(`/documents/${FAKE_DOC_ID}/redact`)
      .set('x-sim-user-id', USER_ID);
    expect(res.status).toBe(401);
  });

  it('returns 401 with no user header', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(makeCleanDoc(), makeStore()));

    const res = await request(app)
      .post(`/documents/${FAKE_DOC_ID}/redact`)
      .set('x-sim-tenant-id', TENANT_ID);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown docId', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(makeDocNotFound(), makeStore()));

    const res = await request(app)
      .post('/documents/nonexistent-doc-id/redact')
      .set('x-sim-tenant-id', TENANT_ID)
      .set('x-sim-user-id', USER_ID);
    expect(res.status).toBe(404);
  });

  it('returns 451 for a quarantined document', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(makeQuarantinedDoc(), makeStore()));

    const res = await request(app)
      .post(`/documents/${FAKE_DOC_ID}/redact`)
      .set('x-sim-tenant-id', TENANT_ID)
      .set('x-sim-user-id', USER_ID);
    expect(res.status).toBe(451);
    expect(res.body.code).toBe('SIM-PLAT-DOC-QUARANTINED');
  });

  it('returns 201 with view_id, doc_id, entity_count on happy path', async () => {
    armPresidioMock();
    const pool = makeCleanDoc();
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(pool, makeStore()));

    const res = await request(app)
      .post(`/documents/${FAKE_DOC_ID}/redact`)
      .set('x-sim-tenant-id', TENANT_ID)
      .set('x-sim-user-id', USER_ID);

    expect(res.status).toBe(201);
    expect(res.body.view_id).toBe(FAKE_VIEW_ID);
    expect(res.body.doc_id).toBe(FAKE_DOC_ID);
    expect(res.body.entity_count).toBe(2);
  });

  it('inserts redaction_view with correct tenant_id and user_id in created_by', async () => {
    armPresidioMock();
    const pool = makeCleanDoc();
    const app = express();
    app.use(express.json());
    app.use(createRedactRouter(pool, makeStore()));

    await request(app)
      .post(`/documents/${FAKE_DOC_ID}/redact`)
      .set('x-sim-tenant-id', TENANT_ID)
      .set('x-sim-user-id', USER_ID);

    const insertCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((args: unknown[]) => (args[0] as string).includes('INSERT INTO docs.redaction_view'));
    expect(insertCall).toBeTruthy();
    const params = (insertCall as unknown[])[1] as string[];
    expect(params).toContain(TENANT_ID);
    expect(params[4]).toContain(USER_ID);
  });
});
