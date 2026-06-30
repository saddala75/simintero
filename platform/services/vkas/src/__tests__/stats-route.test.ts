import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVkasRouter } from '../router.js';

function appWith(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  const app = express();
  app.use(express.json());
  app.locals['pool'] = pool;
  app.use(createVkasRouter());
  return app;
}

describe('GET /v1/stats', () => {
  it('returns artifact counts grouped by status', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET GUC
      .mockResolvedValueOnce({
        rows: [
          { status: 'active', n: 2 },
          { status: 'draft', n: 1 },
        ],
      }) // stats query
      .mockResolvedValueOnce({}); // COMMIT

    const app = appWith(query);
    const res = await request(app)
      .get('/v1/stats')
      .set('x-sim-tenant-id', 'tenant-a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ by_status: { active: 2, draft: 1 } });
  });

  it('returns empty by_status when no artifacts exist', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET GUC
      .mockResolvedValueOnce({ rows: [] }) // stats query — empty
      .mockResolvedValueOnce({}); // COMMIT

    const app = appWith(query);
    const res = await request(app)
      .get('/v1/stats')
      .set('x-sim-tenant-id', 'tenant-b');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ by_status: {} });
  });
});
