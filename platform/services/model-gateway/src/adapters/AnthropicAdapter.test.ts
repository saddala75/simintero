import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './AnthropicAdapter.js';

function mockFetch() {
  const f = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ text: '{"ok":true}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const REQ = {
  model_id: 'claude-sonnet-4-6',
  prompt_text: '{}',
  adapter_config: { max_tokens: 16 },
  no_train_headers: AnthropicAdapter.NO_TRAIN_HEADER,
};

describe('AnthropicAdapter auth', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('injects x-api-key when a key is configured', async () => {
    const f = mockFetch();
    await new AnthropicAdapter('http://x', 'sk-test-123').complete(REQ as any);
    const headers = (f.mock.calls[0]![1] as any).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-123');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-no-training']).toBe('1'); // no-train rail preserved
  });

  it('sends NO x-api-key when the key is empty/undefined (mock path unchanged)', async () => {
    const f = mockFetch();
    await new AnthropicAdapter('http://x', '').complete(REQ as any);
    const headers1 = (f.mock.calls[0]![1] as any).headers as Record<string, string>;
    expect('x-api-key' in headers1).toBe(false);

    await new AnthropicAdapter('http://x').complete(REQ as any); // no key arg at all
    const headers2 = (f.mock.calls[1]![1] as any).headers as Record<string, string>;
    expect('x-api-key' in headers2).toBe(false);
  });
});
