import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../VsacProxy.js';

describe('VsacProxy health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
