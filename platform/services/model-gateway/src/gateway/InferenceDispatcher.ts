import crypto from 'node:crypto';
import { monotonicFactory } from 'ulid';
import type { Pool } from 'pg';
import { applyPhiFilter } from '../phi-filter/PhiFilter.js';
import { AnthropicAdapter } from '../adapters/AnthropicAdapter.js';
import type { ProviderAdapter } from '../adapters/types.js';
import { KillSwitchChecker } from '../kill-switch/KillSwitchChecker.js';
import { withTenant } from '../db/withTenant.js';

const ulid = monotonicFactory();

export interface DispatchRequest {
  task_kind: string;
  prompt_ref: string;
  prompt_version: string;
  model_binding_ref: string;
  model_binding_version: string;
  inputs: Record<string, unknown>;
  tenant_ctx: { tenant_id: string; cell_boundary: 'pooled' | 'dedicated' | 'enclave' };
  workflow_id?: string;
}

interface ModelBindingContent {
  provider: string;
  model_id: string;
  endpoint_overrides: Partial<Record<'pooled' | 'dedicated' | 'enclave', string>>;
  adapter_config: Record<string, unknown>;
  no_train_enforced: boolean;
}

interface VkasArtifact<T> {
  status: string;
  content: T;
}

export class InferenceDispatcher {
  private readonly killSwitch: KillSwitchChecker;

  constructor(
    private readonly pool: Pool,
    private readonly vkasBaseUrl: string,
  ) {
    this.killSwitch = new KillSwitchChecker(pool);
  }

  async dispatch(req: DispatchRequest): Promise<{ output: unknown; request_id: string }> {
    // 1. Kill-switch
    if (await this.killSwitch.isKilled(req.tenant_ctx.tenant_id, req.workflow_id)) {
      throw Object.assign(
        new Error('AI inference disabled for this tenant/workflow'),
        { code: 'SIM-MG-KILL_SWITCH', status: 403 },
      );
    }

    // 2. Resolve model_binding via VKAS
    const bindingArtifact = await this.resolveArtifact<ModelBindingContent>(
      req.model_binding_ref,
      req.model_binding_version,
    );

    // 3. Boundary check
    const endpoint = bindingArtifact.content.endpoint_overrides[req.tenant_ctx.cell_boundary];
    if (!endpoint) {
      throw Object.assign(
        new Error(`No endpoint configured for boundary: ${req.tenant_ctx.cell_boundary}`),
        { code: 'SIM-MG-BOUNDARY', status: 403 },
      );
    }

    // 4. PHI filter
    const safeInputs = applyPhiFilter(req.task_kind, req.inputs);

    // 5. Dispatch to provider
    const adapter = this.adapterFor(bindingArtifact.content.provider, endpoint);
    const result = await adapter.complete({
      model_id: bindingArtifact.content.model_id,
      prompt_text: JSON.stringify({ task_kind: req.task_kind, inputs: safeInputs }),
      adapter_config: bindingArtifact.content.adapter_config,
      no_train_headers: AnthropicAdapter.NO_TRAIN_HEADER,
    });

    // 6. Audit publish — valid shared.outbox envelope, under the tenant GUC.
    const request_id = ulid();
    const outputHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(result.raw_output)).digest('hex')}`;
    const inputRefs = Object.keys(safeInputs);
    const eventId = `evt_${ulid()}`;
    const auditEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.ai.interaction/InferenceServed/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: req.tenant_ctx.tenant_id },
      correlation_id: req.workflow_id ?? request_id,
      payload: {
        request_id,
        task_kind: req.task_kind,
        model_binding_ref: req.model_binding_ref,
        model_binding_version: req.model_binding_version,
        prompt_ref: req.prompt_ref,
        prompt_version: req.prompt_version,
        input_refs: inputRefs,
        output_hash: outputHash,
        latency_ms: result.latency_ms,
        provider_cost_usd: result.provider_cost_usd,
        boundary: req.tenant_ctx.cell_boundary,
      },
    };
    await withTenant(this.pool, req.tenant_ctx.tenant_id, (client) =>
      client.query(
        `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [eventId, 'sim.ai.interaction', request_id, JSON.stringify(auditEnvelope), req.tenant_ctx.tenant_id],
      ),
    );

    // 7. Parse the model's text into structured output. A model returning non-JSON fails cleanly.
    let output: unknown;
    try {
      output = typeof result.raw_output === 'string' ? JSON.parse(result.raw_output) : result.raw_output;
    } catch {
      throw Object.assign(
        new Error('Model returned non-JSON output'),
        { code: 'SIM-MG-OUTPUT_PARSE', status: 502 },
      );
    }
    return { output, request_id };
  }

  private adapterFor(provider: string, endpoint: string): ProviderAdapter {
    if (provider === 'anthropic') return new AnthropicAdapter(endpoint);
    throw new Error(`Unknown provider: ${provider}. Register a new adapter + model_binding artifact.`);
  }

  private async resolveArtifact<T>(ref: string, version: string): Promise<VkasArtifact<T>> {
    const url = `${this.vkasBaseUrl}/v1/artifacts:resolve?canonical_url=${encodeURIComponent(ref)}&version=${encodeURIComponent(version)}`;
    const res = await fetch(url);
    if (res.status === 404) {
      throw Object.assign(new Error(`Artifact not found: ${ref}@${version}`), { status: 422 });
    }
    if (!res.ok) throw new Error(`VKAS resolve error ${res.status}`);
    const artifact = (await res.json()) as VkasArtifact<T>;
    if (artifact.status !== 'active') {
      throw Object.assign(
        new Error(`Artifact ${ref}@${version} is not active (status: ${artifact.status})`),
        { status: 422 },
      );
    }
    return artifact;
  }
}
