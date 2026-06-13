import type { ProviderAdapter, AdapterRequest, AdapterResponse } from './types.js';

interface AnthropicMessage {
  content: Array<{ text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicAdapter implements ProviderAdapter {
  // no_train_enforced: true is asserted in the model_binding artifact (VKAS gate).
  // The adapter adds the header per the Anthropic no-training contract.
  static readonly NO_TRAIN_HEADER = { 'anthropic-no-training': '1' };

  constructor(private readonly endpoint: string) {}

  async complete(req: AdapterRequest): Promise<AdapterResponse> {
    const start = performance.now();
    const res = await fetch(`${this.endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...req.no_train_headers,
      },
      body: JSON.stringify({
        model: req.model_id,
        max_tokens: (req.adapter_config['max_tokens'] as number) ?? 4096,
        messages: [{ role: 'user', content: req.prompt_text }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as AnthropicMessage;
    const latency_ms = Math.round(performance.now() - start);
    const tokens =
      (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    return {
      raw_output: data.content[0]?.text ?? '',
      provider_cost_usd: tokens * 0.000015,
      latency_ms,
    };
  }

  async embed(_req: AdapterRequest): Promise<AdapterResponse> {
    throw new Error('AnthropicAdapter: embed not implemented');
  }
}
