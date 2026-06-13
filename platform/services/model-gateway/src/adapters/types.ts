export interface ProviderAdapter {
  complete(req: AdapterRequest): Promise<AdapterResponse>;
  embed(req: AdapterRequest): Promise<AdapterResponse>;
}

export interface AdapterRequest {
  model_id: string;
  prompt_text: string;
  adapter_config: Record<string, unknown>;
  no_train_headers: Record<string, string>;
}

export interface AdapterResponse {
  raw_output: unknown;
  provider_cost_usd: number;
  latency_ms: number;
}
