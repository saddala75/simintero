import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
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
    expect(result.output).toEqual({ result: 'ok' });
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
    pool = makePool();
    dispatcher = new InferenceDispatcher(pool, 'http://vkas-mock');
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ACTIVE_BINDING })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        content: [{ text: '{"assertions":[]}' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      }) });

    await dispatcher.dispatch({
      task_kind: 'summarize',
      prompt_ref: 'ref', prompt_version: '1.0.0',
      model_binding_ref: 'ref', model_binding_version: '1.0.0',
      inputs: { document_span_refs: [] },
      tenant_ctx: VALID_CTX,
    });

    const client = await (pool.connect as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const insertCall = calls.find((a) => typeof a[0] === 'string' && (a[0] as string).includes('shared.outbox'));
    expect(insertCall).toBeTruthy();
    expect(insertCall![0]).toContain('event_id');
    expect(insertCall![0]).toContain('envelope');
    expect(insertCall![0]).not.toContain('payload');
    const params = insertCall![1] as unknown[];
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect((envelope['payload'] as Record<string, unknown>)['request_id']).toBeTruthy();
    expect(JSON.stringify(envelope)).not.toContain('text_segments');
  });

  describe('ANTHROPIC_API_KEY threading', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('passes x-api-key to the outgoing Anthropic fetch when dispatcher is constructed with a key', async () => {
      const dispatcherWithKey = new InferenceDispatcher(makePool(), 'http://vkas-mock', 'sk-ant-test-999');
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ACTIVE_BINDING })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          content: [{ text: '{"result":"key-ok"}' }],
          usage: { input_tokens: 5, output_tokens: 5 },
        }) });
      vi.stubGlobal('fetch', fetchMock);

      await dispatcherWithKey.dispatch({
        task_kind: 'summarize',
        prompt_ref: 'ref', prompt_version: '1.0.0',
        model_binding_ref: 'ref', model_binding_version: '1.0.0',
        inputs: {},
        tenant_ctx: VALID_CTX,
      });

      // The second fetch call is the Anthropic adapter call (first is VKAS resolve)
      const anthropicCallHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
      expect(anthropicCallHeaders['x-api-key']).toBe('sk-ant-test-999');
    });

    it('sends NO x-api-key when dispatcher is constructed with empty key (mock path unchanged)', async () => {
      const dispatcherNoKey = new InferenceDispatcher(makePool(), 'http://vkas-mock', '');
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ACTIVE_BINDING })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          content: [{ text: '{"result":"no-key-ok"}' }],
          usage: { input_tokens: 5, output_tokens: 5 },
        }) });
      vi.stubGlobal('fetch', fetchMock);

      await dispatcherNoKey.dispatch({
        task_kind: 'summarize',
        prompt_ref: 'ref', prompt_version: '1.0.0',
        model_binding_ref: 'ref', model_binding_version: '1.0.0',
        inputs: {},
        tenant_ctx: VALID_CTX,
      });

      const anthropicCallHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
      expect('x-api-key' in anthropicCallHeaders).toBe(false);
    });
  });
});
