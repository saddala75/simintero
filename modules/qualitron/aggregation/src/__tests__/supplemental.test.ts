import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createSupplementalRouter } from '../routes/supplemental.js';

function makePool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

describe('POST /v1/quality/supplemental', () => {
  let app: ReturnType<typeof express>;
  let pool: Pool;

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

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, insertArgs] = queryMock.mock.calls[0]! as [string, unknown[]];
    expect(insertArgs![0]).toBe('tenant_abc');
    expect(insertArgs![1]).toBe('sim.qual.supplemental');
    const payload = JSON.parse(insertArgs![2] as string) as Record<string, unknown>;
    expect(payload['doc_id']).toBe(res.body.doc_id);
    expect(payload['member_id']).toBe('mem_001');
    expect(payload['filename']).toBe('test.pdf');
    // raw content must NOT be in the outbox payload
    expect(JSON.stringify(payload)).not.toContain('aGVsbG8=');
  });
});
