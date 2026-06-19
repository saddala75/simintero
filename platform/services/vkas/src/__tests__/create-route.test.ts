import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

function appWith(pool: { query: ReturnType<typeof vi.fn> }) {
  const app = express();
  app.use(express.json());
  app.locals['pool'] = pool;
  app.use(createVkasRouter());
  return app;
}

describe('POST /v1/artifacts (create draft)', () => {
  it('inserts a draft and returns artifact_id=canonical_url', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const app = appWith({ query });
    const res = await request(app).post('/v1/artifacts').send({
      canonical_url: 'https://artifacts.simintero.io/shared/coverage_rule/29826',
      artifact_type: 'coverage_rule',
      content: { pa_required: true },
      created_by: 'author-x',
    });
    expect(res.status).toBe(201);
    expect(res.body.artifact_id).toBe('https://artifacts.simintero.io/shared/coverage_rule/29826');
    expect(res.body.canonical_url).toBe('https://artifacts.simintero.io/shared/coverage_rule/29826');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.status).toBe('draft');
    // INSERT issued with draft status + shared tenant + a content_hash
    const call = query.mock.calls[0]!;
    const sql = call[0] as string;
    const params = call[1] as unknown[];
    expect(sql).toMatch(/INSERT INTO vkas\.artifact/i);
    expect(sql).toMatch(/'draft'/);
    expect(params).toContain('shared'); // tenant_id default
    expect(params.some((p) => typeof p === 'string' && p.startsWith('sha256:'))).toBe(true);
  });

  it('400 when canonical_url missing', async () => {
    const app = appWith({ query: vi.fn() });
    const res = await request(app).post('/v1/artifacts').send({ artifact_type: 'coverage_rule', content: {} });
    expect(res.status).toBe(400);
  });

  it('409 when artifact already exists (ON CONFLICT no-op)', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0 });
    const app = appWith({ query });
    const res = await request(app).post('/v1/artifacts').send({
      canonical_url: 'https://x/y', artifact_type: 'coverage_rule', content: {},
    });
    expect(res.status).toBe(409);
  });
});
