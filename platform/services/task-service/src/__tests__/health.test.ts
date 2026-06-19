import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTaskRouter } from '../router.js';
import { transitionStatus, StatusTransitionError } from '../lifecycle.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(createTaskRouter());
  return app;
}

describe('task-service scaffold', () => {
  it('healthz', async () => {
    const res = await request(buildApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
  it('lifecycle transitions', () => {
    expect(transitionStatus('open', 'in_progress')).toBe('in_progress');
    expect(() => transitionStatus('resolved', 'open')).toThrow(StatusTransitionError);
  });
});
