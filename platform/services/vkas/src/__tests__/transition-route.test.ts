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

  it('activating v2 demotes the prior active v1 to superseded', async () => {
    // v2 is in_review (the version being activated); the pool also handles the
    // demotion UPDATE for any prior active version (returns rowCount: 1).
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/SELECT status/i.test(sql)) {
        return { rows: [{ status: 'in_review' }] };
      }
      // demotion UPDATE or activation UPDATE — both succeed
      return { rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const app = express();
    app.use(express.json());
    app.locals['pool'] = { connect: vi.fn(async () => client) };
    app.use(createVkasRouter());

    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'policy://pa-criteria/v1', version: '2.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // The handler must have issued a demotion UPDATE for the prior active version
    expect(
      calls.some((s) => /UPDATE vkas\.artifact SET status='superseded'/i.test(s))
    ).toBe(true);
    // The demotion must scope to the same canonical_url but a DIFFERENT version
    expect(
      calls.some(
        (s) =>
          /status='superseded'/i.test(s) &&
          /status='active'/i.test(s) &&
          /version <>/i.test(s),
      )
    ).toBe(true);
  });

  it('first-time activation (no prior active) issues no demotion error', async () => {
    // When rowCount=0 from the demotion UPDATE it simply means no prior active existed;
    // the handler must still succeed and NOT issue a 422/500.
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/SELECT status/i.test(sql)) {
        return { rows: [{ status: 'approved' }] };
      }
      if (/status='superseded'/i.test(sql)) {
        return { rowCount: 0 }; // no prior active existed
      }
      return { rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const app = express();
    app.use(express.json());
    app.locals['pool'] = { connect: vi.fn(async () => client) };
    app.use(createVkasRouter());

    const res = await request(app)
      .post('/v1/artifacts/activate')
      .send({ canonical_url: 'policy://pa-criteria/v1', version: '1.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    // activation UPDATE must still be issued
    expect(calls.some((s) => /UPDATE vkas\.artifact SET status='active'/i.test(s))).toBe(true);
  });
});
