// modules/revital/pipeline/src/fabric/writeAiEvidence.ts
import { buildFabricResource } from './buildFabricResource.js';
import { buildProvenance } from './buildProvenance.js';

interface PoolClient { query(sql: string, params?: any[]): Promise<{ rows: any[] }>; }

export interface AiEvidenceInput {
  analysis_id: string;
  member_ref?: string | undefined;
  document_refs: string[];
  model_binding_ref?: string | undefined;
  model_binding_version?: string | undefined;
  extraction: {
    status: 'ok' | 'abstained';
    resources: Array<{
      resource_type: string;
      provenance_ref: string;
      normalization:
        | { coded: true; system: string; code: string; display?: string; raw_text: string; resource_type: string }
        | { coded: false };
    }>;
  };
}

const AI_SOURCE = 'ai-extraction';
const UPSERT = `INSERT INTO fabric.resource
  (tenant_id, resource_type, fhir_id, member_ref, source, provenance_ref, content)
  VALUES (current_setting('sim.tenant_id', true), $1, $2, $3, $4, $5, $6::jsonb)
  ON CONFLICT (tenant_id, resource_type, fhir_id) DO UPDATE SET
    content = EXCLUDED.content, member_ref = EXCLUDED.member_ref,
    version = fabric.resource.version + 1, last_updated = now()`;

/**
 * Persist Revital's CODED extracted resources + their ai_citation Provenance to fabric.resource
 * (source='ai-extraction'). Runs inside an existing withTenant transaction (GUC already set).
 * Degrades open: a missing member_ref or an abstained extraction → skip, never throw.
 * member_ref is threaded in from the analysis request's case_context (not resolved from ens.case).
 */
export async function writeAiEvidence(client: PoolClient, input: AiEvidenceInput): Promise<void> {
  if (input.extraction.status !== 'ok') return;

  const member_ref = input.member_ref;
  if (!member_ref) return; // degrade-open

  const model_agent =
    input.model_binding_ref && input.model_binding_version
      ? `${input.model_binding_ref}@${input.model_binding_version}`
      : undefined;

  let i = 0;
  for (const r of input.extraction.resources) {
    const n = r.normalization;
    if (!n.coded) { i++; continue; }

    const fhir_id = `ai-${input.analysis_id}-${i}`;
    const content = buildFabricResource({
      fhir_id, resource_type: n.resource_type, system: n.system, code: n.code,
      display: n.display, raw_text: n.raw_text, member_ref,
    });
    await client.query(UPSERT, [n.resource_type, fhir_id, member_ref, AI_SOURCE, r.provenance_ref, JSON.stringify(content)]);

    const prov_fhir_id = `prov-ai-${input.analysis_id}-${i}`;
    const provenance = buildProvenance({
      provenance_fhir_id: prov_fhir_id, target_resource_type: n.resource_type, target_fhir_id: fhir_id,
      request_id: r.provenance_ref, document_refs: input.document_refs, model_agent,
    });
    await client.query(UPSERT, ['Provenance', prov_fhir_id, member_ref, AI_SOURCE, r.provenance_ref, JSON.stringify(provenance)]);
    i++;
  }
}
