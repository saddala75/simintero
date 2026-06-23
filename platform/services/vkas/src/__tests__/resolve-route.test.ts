import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

function appWith(rows: unknown[]) {
  const client = { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = pool;
  app.use(createVkasRouter());
  return { app, pool };
}

const ROW = {
  canonical_url: 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
  version: '1.0.0', tenant_id: 'shared', artifact_type: 'model_binding', status: 'active',
  effective_from: null, effective_to: null, applicability: {},
  content: { provider: 'anthropic', model_id: 'm', endpoint_overrides: { pooled: 'http://mock-llm:3060' }, adapter_config: {}, no_train_enforced: true },
  content_hash: 'h', relations: [], metadata: {}, created_by: 'seed', created_at: new Date(),
};

describe('GET /v1/artifacts:resolve', () => {
  it('returns {status, content} for an exact active version', async () => {
    const { app } = appWith([ROW]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '1.0.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.content.provider).toBe('anthropic');
  });
  it('404 when the requested version does not exist', async () => {
    const { app } = appWith([]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '9.9.9' });
    expect(res.status).toBe(404);
  });
  it('404 for a pinned non-active (in_review) candidate WITHOUT the eval-only flag (fail-closed default)', async () => {
    const { app } = appWith([{ ...ROW, version: '1.1.0', status: 'in_review' }]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '1.1.0' });
    expect(res.status).toBe(404);
  });
  it('returns a pinned non-active (in_review) candidate WITH allow_non_active=true', async () => {
    const { app } = appWith([{ ...ROW, version: '1.1.0', status: 'in_review' }]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '1.1.0', allow_non_active: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
    expect(res.body.content.provider).toBe('anthropic');
  });
  it('returns a pinned approved candidate WITH allow_non_active=true', async () => {
    const { app } = appWith([{ ...ROW, version: '1.1.0', status: 'approved' }]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '1.1.0', allow_non_active: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });
  it('still returns a pinned ACTIVE version WITHOUT the flag', async () => {
    const { app } = appWith([{ ...ROW, version: '1.1.0', status: 'active' }]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url, version: '1.1.0' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
  it('400 when canonical_url missing', async () => {
    const { app } = appWith([]);
    const res = await request(app).get('/v1/artifacts:resolve');
    expect(res.status).toBe(400);
  });
  it('falls back to resolveEffectiveVersion when no version given', async () => {
    const { app } = appWith([ROW]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url });
    expect(res.status).toBe(200);
    expect(res.body.content.provider).toBe('anthropic');
  });
  it('no-version path still returns only the active version (ignores non-active)', async () => {
    const { app } = appWith([
      { ...ROW, version: '1.0.0', status: 'active' },
      { ...ROW, version: '1.1.0', status: 'in_review' },
    ]);
    const res = await request(app).get('/v1/artifacts:resolve').query({ canonical_url: ROW.canonical_url });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});
