import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import type { ObjectStore } from '../store/ObjectStore.js';
import { createSpanRouter } from '../routes/span.js';

function mockPool(rowsFor: (sql: string) => unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rowsFor(sql) };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) } as unknown as Pool, calls };
}

describe('GET /documents/:docId/span', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('reads under withTenant (GUC before SELECT) and returns the store bytes', async () => {
    const { pool, calls } = mockPool((sql) =>
      sql.includes('SELECT') && sql.includes('docs.document')
        ? [{ virus_scan_status: 'clean', text_key: 't1/docs/x/text', object_key: 't1/docs/x' }]
        : [],
    );
    const store: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async () => Buffer.from('TEXT')),
      delete: vi.fn(),
    };
    app.use(createSpanRouter(pool, store));

    const res = await request(app)
      .get('/documents/doc-1/span')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe('TEXT');
    // set_config('sim.tenant_id', ['tenant-dev']) ran before the SELECT
    const guc = calls.findIndex((c) => c.sql.includes("set_config('sim.tenant_id'"));
    const sel = calls.findIndex((c) => c.sql.includes('SELECT') && c.sql.includes('docs.document'));
    expect(guc).toBeGreaterThanOrEqual(0);
    expect(calls[guc]?.params).toEqual(['tenant-dev']);
    expect(sel).toBeGreaterThan(guc);
    expect(store.get).toHaveBeenCalledWith('t1/docs/x/text');
  });

  it('returns 451 for a quarantined document', async () => {
    const { pool } = mockPool((sql) =>
      sql.includes('SELECT') && sql.includes('docs.document')
        ? [{ virus_scan_status: 'quarantined', text_key: null, object_key: 'd2/raw' }]
        : [],
    );
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    app.use(createSpanRouter(pool, store));

    const res = await request(app)
      .get('/documents/d2/span')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(451);
  });

  it('returns 404 when the doc row is not visible/absent', async () => {
    const { pool } = mockPool(() => []);
    const store: ObjectStore = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    app.use(createSpanRouter(pool, store));

    const res = await request(app)
      .get('/documents/missing/span')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(404);
  });
});
