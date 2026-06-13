import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { createSpanRouter } from '../routes/span.js';

function makeCleanDoc(docId: string): Pool {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [{
        doc_id: docId,
        virus_scan_status: 'clean',
        text_key: `tenant/docs/${docId}/text`,
        object_key: `tenant/docs/${docId}/raw`,
        legal_hold: false,
      }],
    }),
  } as unknown as Pool;
}

describe('GET /documents/:docId/span', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('returns 200 with bytes for a clean document', async () => {
    const store: ObjectStore = { put: vi.fn(), get: vi.fn().mockResolvedValue(Buffer.from('text content')), delete: vi.fn() };
    app.use(createSpanRouter(makeCleanDoc('d1'), store));

    const res = await request(app)
      .get('/documents/d1/span')
      .query({ page: '1', region: '0,0,100,100' })
      .set('x-sim-tenant-id', 't_test');

    expect(res.status).toBe(200);
  });

  it('returns 451 for a quarantined document', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ doc_id: 'd2', virus_scan_status: 'quarantined' }],
      }),
    } as unknown as Pool;
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    app.use(createSpanRouter(pool, store));

    const res = await request(app)
      .get('/documents/d2/span')
      .query({ page: '1' })
      .set('x-sim-tenant-id', 't_test');

    expect(res.status).toBe(451);
  });
});
