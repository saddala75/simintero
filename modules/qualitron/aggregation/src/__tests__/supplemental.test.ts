import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createSupplementalRouter } from '../routes/supplemental.js';

// Pool mock: the route's outbox write routes through pool.connect -> client.query
// (withTenant + appendEvent → canonical envelope, RLS GUC set on the same client).
function makePool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  } as any;
  pool.__client = client;
  return pool as Pool & { __client: typeof client; connect: ReturnType<typeof vi.fn> };
}

describe('POST /v1/quality/supplemental', () => {
  let app: ReturnType<typeof express>;
  let pool: ReturnType<typeof makePool>;

  beforeEach(() => {
    pool = makePool();
    app = express();
    app.use(express.json());
    app.use(createSupplementalRouter(pool));
  });

  it('returns 401 when x-sim-tenant-id header is absent', async () => {
    const res = await request(app)
      .post('/v1/quality/supplemental')
      .send({ member_id: 'mem_001', doc_content_base64: 'aGVsbG8=' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when member_id is absent', async () => {
    const res = await request(app)
      .post('/v1/quality/supplemental')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send({ doc_content_base64: 'aGVsbG8=' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when doc_content_base64 is absent', async () => {
    const res = await request(app)
      .post('/v1/quality/supplemental')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send({ member_id: 'mem_001' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 202 with doc_id on a valid request and writes to outbox', async () => {
    const res = await request(app)
      .post('/v1/quality/supplemental')
      .set('x-sim-tenant-id', 'tenant_abc')
      .send({
        member_id: 'mem_001',
        doc_content_base64: 'aGVsbG8=',
        filename: 'test.pdf',
      });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('doc_id');
    expect(typeof res.body.doc_id).toBe('string');
    expect(res.body.doc_id.length).toBeGreaterThan(0);
    expect(res.body.status).toBe('accepted');

    // Outbox write routes through pool.connect -> client.query (withTenant).
    expect(pool.connect).toHaveBeenCalledTimes(1);
    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;

    // withTenant sets the RLS GUC on the same client before the INSERT
    const setConfig = calls.find((c) => /set_config/.test(c[0]))!;
    expect(setConfig[0]).toContain('sim.tenant_id');
    expect(setConfig[1]).toEqual(['tenant_abc']);

    // canonical 5-column INSERT — no phantom payload column
    const insert = calls.find((c) => /INSERT INTO shared\.outbox/.test(c[0]))!;
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('event_id');
    expect(insert[0]).toContain('envelope');
    expect(insert[0]).not.toContain('payload)');

    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.qual.supplemental'); // topic
    expect(params[4]).toBe('tenant_abc'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.qual.supplemental/SupplementalIngested/v1');
    expect(envelope['correlation_id']).toBe('mem_001');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['doc_id']).toBe(res.body.doc_id);
    expect(payload['member_id']).toBe('mem_001');
    expect(payload['filename']).toBe('test.pdf');
    // raw content must NOT be in the outbox envelope at all
    expect(JSON.stringify(envelope)).not.toContain('aGVsbG8=');

    expect(calls.some((c) => c[0] === 'COMMIT')).toBe(true);
  });
});
