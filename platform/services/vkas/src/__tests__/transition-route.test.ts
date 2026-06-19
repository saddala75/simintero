import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

function appWith(statusRow: string | null) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/SELECT status/i.test(sql)) {
      return { rows: statusRow ? [{ status: statusRow }] : [] };
    }
    return { rowCount: 1 }; // UPDATE / BEGIN / COMMIT / set_config
  });
  const client = { query, release: vi.fn() };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = { connect: vi.fn(async () => client) };
  app.use(createVkasRouter());
  return { app, query, calls };
}

describe('POST /v1/artifacts/submit', () => {
  it('draft → in_review', async () => {
    const { app, calls } = appWith('draft');
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='in_review'/i.test(s))).toBe(true);
  });

  it('invalid transition (active → in_review) → 422', async () => {
    const { app } = appWith('active');
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(422);
  });

  it('404 when not found', async () => {
    const { app } = appWith(null);
    const res = await request(app)
      .post('/v1/artifacts/submit')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/artifacts/activate', () => {
  it('in_review → active (folds approved)', async () => {
    const { app, calls } = appWith('in_review');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });

  it('approved → active', async () => {
    const { app } = appWith('approved');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(200);
  });

  it('draft → active is invalid → 422', async () => {
    const { app } = appWith('draft');
    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'u', version: '1.0.0' });
    expect(res.status).toBe(422);
  });
});
