import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { createIngestRouter } from '../routes/ingest.js';

function makePool(docId = 'doc-uuid-1'): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ doc_id: docId }] }),
  } as unknown as Pool;
}

function makeStore(): ObjectStore {
  return { put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn() };
}

describe('POST /documents/ingest', () => {
  let app: ReturnType<typeof express>;
  let pool: Pool;
  let store: ObjectStore;

  beforeEach(() => {
    pool = makePool();
    store = makeStore();
    app = express();
    app.use(express.json());
    app.use(createIngestRouter(pool, store));
  });

  it('returns 202 with doc_id for a valid portal_upload', async () => {
    const res = await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 't_test')
      .send({
        channel: 'portal_upload',
        raw_payload: Buffer.from('PDF content').toString('base64'),
        created_by: { type: 'human', id: 'u_123' },
      });
    expect(res.status).toBe(202);
    expect(res.body.doc_id).toBe('doc-uuid-1');
  });

  it('persists raw bytes to object store BEFORE inserting the DB row', async () => {
    let putCalledBefore = false;
    (store.put as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      putCalledBefore = true;
    });
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      expect(putCalledBefore).toBe(true);
      return { rows: [{ doc_id: 'doc-1' }] };
    });

    await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 't_test')
      .send({ channel: 'portal_upload', raw_payload: 'data', created_by: { type: 'service', id: 'svc' } });
  });

  it('returns 400 for an invalid channel', async () => {
    const res = await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 't_test')
      .send({ channel: 'fax_print', raw_payload: 'x', created_by: { type: 'service', id: 'svc' } });
    expect(res.status).toBe(400);
  });
});
