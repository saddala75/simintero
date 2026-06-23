import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { InferenceDispatcher } from '../../gateway/InferenceDispatcher.js';
import { createEvalRouter } from '../eval.js';
import type { Pool } from 'pg';

const APPROVED_BINDING = {
  status: 'approved', // candidate — NOT yet active
  content: {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-6',
    endpoint_overrides: { pooled: 'http://mock-anthropic', dedicated: 'http://mock-anthropic' },
    adapter_config: { max_tokens: 1024 },
    no_train_enforced: true,
  },
};

function makePool(): Pool {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

function makeApp(dispatcher: InferenceDispatcher): Express {
  const app = express();
  app.use(express.json());
  app.use(createEvalRouter(dispatcher));
  return app;
}

describe('POST /eval', () => {
  let app: Express;

  beforeEach(() => {
    const dispatcher = new InferenceDispatcher(makePool(), 'http://vkas-mock');
    app = makeApp(dispatcher);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => APPROVED_BINDING }) // VKAS resolve
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        content: [{ text: '{"result":"eval-ok"}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }) }), // Anthropic adapter
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resolves a non-active candidate binding and returns 200 {output, request_id}', async () => {
    const res = await request(app)
      .post('/eval')
      .set('x-sim-tenant-id', 't_test')
      .set('x-sim-cell-boundary', 'pooled')
      .send({
        task_kind: 'summarize',
        prompt_ref: 'https://artifacts.simintero.io/shared/prompt/pa-summary',
        prompt_version: '1.0.0',
        model_binding_ref: 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
        model_binding_version: '1.1.0',
        inputs: { document_span_refs: ['doc_1#p1'] },
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toEqual({ result: 'eval-ok' });
    expect(res.body.request_id).toBeTruthy();
  });
});
