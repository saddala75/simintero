import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { createIngestRouter, type WorkflowStarter } from '../routes/ingest.js';

function makeStarter(): WorkflowStarter {
  return { start: vi.fn().mockResolvedValue({ workflowId: 'doc-uuid-1' }) };
}

function makePool(docId = 'doc-uuid-1'): Pool {
  const client = {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO docs.document')) {
        return { rows: [{ doc_id: docId }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

function makeStore(): ObjectStore {
  return { put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn() };
}

describe('POST /documents/ingest', () => {
  let app: ReturnType<typeof express>;
  let pool: Pool;
  let store: ObjectStore;
  let starter: WorkflowStarter;

  beforeEach(() => {
    pool = makePool();
    store = makeStore();
    starter = makeStarter();
    app = express();
    app.use(express.json());
    app.use(createIngestRouter(pool, store, starter));
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
    let putCalled = false;
    (store.put as ReturnType<typeof vi.fn>).mockImplementation(async () => { putCalled = true; });

    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO docs.document')) {
          expect(putCalled).toBe(true);
          return { rows: [{ doc_id: 'doc-1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    app = express();
    app.use(express.json());
    app.use(createIngestRouter(pool, store, starter));

    await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 't_test')
      .send({ channel: 'portal_upload', raw_payload: 'data', created_by: { type: 'service', id: 'svc' } });

    expect(putCalled).toBe(true);
  });

  it('stores bytes, inserts, and starts the docIngest workflow with [docId, tenantId]', async () => {
    const res = await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 'tenant-dev')
      .send({
        channel: 'portal_upload',
        raw_payload: Buffer.from('hi').toString('base64'),
        created_by: { type: 'service', id: 'x' },
      });
    expect(res.status).toBe(202);
    expect(res.body.doc_id).toBe('doc-uuid-1');
    expect(store.put).toHaveBeenCalled();
    expect(starter.start).toHaveBeenCalledWith(
      'docIngest',
      expect.objectContaining({ workflowId: 'doc-uuid-1', taskQueue: 'doc-ingest', args: ['doc-uuid-1', 'tenant-dev'] }),
    );
  });

  it('returns 400 for an invalid channel', async () => {
    const res = await request(app)
      .post('/documents/ingest')
      .set('x-sim-tenant-id', 't_test')
      .send({ channel: 'fax_print', raw_payload: 'x', created_by: { type: 'service', id: 'svc' } });
    expect(res.status).toBe(400);
  });
});
