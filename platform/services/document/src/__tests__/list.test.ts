import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createListRouter } from '../routes/list.js';

function makePool(rows: unknown[]): Pool {
  const client = {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM docs.document')) return { rows };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

describe('GET /documents', () => {
  let app: ReturnType<typeof express>;

  function mount(pool: Pool) {
    app = express();
    app.use(createListRouter(pool));
  }

  beforeEach(() => { app = express(); });

  it('returns the documents for a case_ref', async () => {
    const docs = [{ doc_id: 'd1', case_ref: 'corr-1', source_channel: 'fhir_binary',
                    virus_scan_status: 'pending', ingested_at: '2026-06-16T00:00:00Z' }];
    mount(makePool(docs));
    const res = await request(app)
      .get('/documents?case_ref=corr-1')
      .set('x-sim-tenant-id', 't_test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(docs);
  });

  it('returns 400 when case_ref is missing', async () => {
    mount(makePool([]));
    const res = await request(app).get('/documents').set('x-sim-tenant-id', 't_test');
    expect(res.status).toBe(400);
  });

  it('queries with the tenant GUC set (uses pool.connect)', async () => {
    const pool = makePool([]);
    mount(pool);
    await request(app).get('/documents?case_ref=corr-1').set('x-sim-tenant-id', 't_test');
    expect((pool.connect as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
