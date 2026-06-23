import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createSpansRouter } from '../routes/spans.js';
import { createSpanRouter } from '../routes/span.js';
import type { ObjectStore } from '../store/ObjectStore.js';

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

const SAMPLE_SPANS = [
  { seq: 1, page: 1, region: [10, 20, 200, 40], text: 'Hello world', excerpt_hash: 'abc123' },
  { seq: 2, page: 1, region: [10, 50, 200, 70], text: 'Second span', excerpt_hash: 'def456' },
];

describe('GET /documents/:doc_id/spans', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('returns 200 with doc_id and spans array for a clean doc', async () => {
    const { pool, calls } = mockPool((sql) => {
      if (sql.includes('docs.document') && !sql.includes('document_span')) {
        return [{ virus_scan_status: 'clean' }];
      }
      if (sql.includes('document_span')) {
        return SAMPLE_SPANS;
      }
      return [];
    });
    app.use(createSpansRouter(pool));

    const res = await request(app)
      .get('/documents/doc-abc/spans')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(200);
    expect(res.body.doc_id).toBe('doc-abc');
    expect(Array.isArray(res.body.spans)).toBe(true);
    expect(res.body.spans).toHaveLength(2);

    const first = res.body.spans[0];
    expect(first.seq).toBe(1);
    expect(first.page).toBe(1);
    expect(first.region).toEqual([10, 20, 200, 40]);
    expect(first.text).toBe('Hello world');
    expect(first.excerpt_hash).toBe('abc123');

    // GUC set before SELECT (withTenant ran)
    const guc = calls.findIndex((c) => c.sql.includes("set_config('sim.tenant_id'"));
    const sel = calls.findIndex((c) => c.sql.includes('document_span'));
    expect(guc).toBeGreaterThanOrEqual(0);
    expect(calls[guc]?.params).toEqual(['tenant-dev']);
    expect(sel).toBeGreaterThan(guc);
  });

  it('returns 451 for a quarantined document', async () => {
    const { pool } = mockPool((sql) => {
      if (sql.includes('docs.document') && !sql.includes('document_span')) {
        return [{ virus_scan_status: 'quarantined' }];
      }
      return [];
    });
    app.use(createSpansRouter(pool));

    const res = await request(app)
      .get('/documents/doc-quarantine/spans')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(451);
    expect(res.body.code).toBe('SIM-PLAT-DOC-QUARANTINED');
  });

  it('returns 404 when the doc row is missing or cross-tenant', async () => {
    const { pool } = mockPool(() => []);
    app.use(createSpansRouter(pool));

    const res = await request(app)
      .get('/documents/missing/spans')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(404);
  });

  it('returns an empty spans array when the doc has no spans yet', async () => {
    const { pool } = mockPool((sql) => {
      if (sql.includes('docs.document') && !sql.includes('document_span')) {
        return [{ virus_scan_status: 'clean' }];
      }
      return [];
    });
    app.use(createSpansRouter(pool));

    const res = await request(app)
      .get('/documents/doc-empty/spans')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(200);
    expect(res.body.doc_id).toBe('doc-empty');
    expect(res.body.spans).toEqual([]);
  });
});

// Regression: the original GET /documents/:docId/span (text) route is unchanged
describe('GET /documents/:docId/span (regression)', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('still returns 200 with store bytes for a clean doc', async () => {
    const { pool } = mockPool((sql) =>
      sql.includes('SELECT') && sql.includes('docs.document')
        ? [{ virus_scan_status: 'clean', text_key: 't1/text', object_key: 't1/raw' }]
        : [],
    );
    const store: ObjectStore = {
      put: vi.fn(),
      get: vi.fn(async () => Buffer.from('ORIGINAL TEXT')),
      delete: vi.fn(),
    };
    app.use(createSpanRouter(pool, store));

    const res = await request(app)
      .get('/documents/doc-1/span')
      .set('x-sim-tenant-id', 'tenant-dev');

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe('ORIGINAL TEXT');
  });

  it('still returns 451 for quarantined on the old route', async () => {
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
});
