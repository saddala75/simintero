import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InferenceDispatcher } from '../InferenceDispatcher.js';
import type { Pool } from 'pg';

const ACTIVE_BINDING = {
  status: 'active',
  content: {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-6',
    endpoint_overrides: { pooled: 'http://mock-anthropic', dedicated: 'http://mock-anthropic' },
    adapter_config: { max_tokens: 1024 },
    no_train_enforced: true,
  },
};

function makePool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

const VALID_CTX = { tenant_id: 't_test', cell_boundary: 'pooled' as const };

describe('InferenceDispatcher', () => {
  let dispatcher: InferenceDispatcher;
  let pool: Pool;

  beforeEach(() => {
    pool = makePool();
    dispatcher = new InferenceDispatcher(pool, 'http://vkas-mock');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('dispatches inference and returns output + request_id', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ACTIVE_BINDING })  // VKAS
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        content: [{ text: '{"result":"ok"}' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      }) });  // Anthropic

    const result = await dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'https://artifacts.simintero.io/shared/prompt/pa-summary',
      prompt_version: '1.0.0',
      model_binding_ref: 'https://artifacts.simintero.io/shared/model_binding/claude-pa',
      model_binding_version: '1.0.0',
      inputs: { document_span_refs: ['doc_1#p1'], section_labels: ['History'] },
      tenant_ctx: VALID_CTX,
    });

    expect(result.request_id).toBeTruthy();
    expect(result.output).toBeDefined();
  });

  it('throws SIM-MG-BOUNDARY when binding has no endpoint for caller boundary', async () => {
    const bindingNoEnclave = {
      ...ACTIVE_BINDING,
      content: { ...ACTIVE_BINDING.content, endpoint_overrides: { pooled: 'http://x' } },
    };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => bindingNoEnclave });

    await expect(dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'ref', prompt_version: '1.0.0',
      model_binding_ref: 'ref', model_binding_version: '1.0.0',
      inputs: {},
      tenant_ctx: { tenant_id: 't_test', cell_boundary: 'enclave' },
    })).rejects.toMatchObject({ code: 'SIM-MG-BOUNDARY', status: 403 });
  });

  it('throws SIM-MG-KILL_SWITCH when ai.inference.disabled is set', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ key: 'ai.inference.disabled', value: { value: true } }],
    });

    await expect(dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'ref', prompt_version: '1.0.0',
      model_binding_ref: 'ref', model_binding_version: '1.0.0',
      inputs: {},
      tenant_ctx: VALID_CTX,
    })).rejects.toMatchObject({ code: 'SIM-MG-KILL_SWITCH', status: 403 });
  });

  it('throws 422 when model_binding artifact is not active', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'draft', content: {} }) });

    await expect(dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'ref', prompt_version: '1.0.0',
      model_binding_ref: 'ref', model_binding_version: '1.0.0',
      inputs: {},
      tenant_ctx: VALID_CTX,
    })).rejects.toMatchObject({ status: 422 });
  });

  it('publishes audit entry to shared.outbox after successful dispatch', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ACTIVE_BINDING })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        content: [{ text: 'result' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      }) });

    await dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'ref', prompt_version: '1.0.0',
      model_binding_ref: 'ref', model_binding_version: '1.0.0',
      inputs: { document_span_refs: [] },
      tenant_ctx: VALID_CTX,
    });

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const insertCall = calls.find((args) => {
      const sql = args[0];
      return typeof sql === 'string' && sql.includes('shared.outbox');
    });
    expect(insertCall).toBeTruthy();
    // insertCall is [sql, params] where params[2] is the JSON payload string
    const params = insertCall![1] as unknown[];
    const topic = params[1] as string;
    const payload = JSON.parse(params[2] as string) as Record<string, unknown>;
    expect(topic).toBeTruthy();
    expect(payload['request_id']).toBeTruthy();
    // Raw inputs must not appear — only refs
    expect(JSON.stringify(payload)).not.toContain('text_segments');
  });
});
