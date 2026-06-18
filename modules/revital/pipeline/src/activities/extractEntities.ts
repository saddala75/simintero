import { normalizeEntity } from '@sim/revital-extraction';
import type { SpanMap } from './parseSegment.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

export interface ExtractionBlock {
  status: 'ok' | 'abstained';
  resources: Array<{
    fabric_ref: string;
    resource_type: string;
    provenance_ref: string;
    normalization: { system: string; code: string; raw_text: string };
    confidence: number;
  }>;
}

export async function extractEntitiesImpl(
  spanMap: SpanMap,
  input: AnalysisInput,
  gatewayUrl: string,
  tenantId: string,
): Promise<ExtractionBlock> {
  const docSpanRefs = Object.keys(spanMap);
  const textSegments = Object.values(spanMap)
    .flat()
    .slice(0, 20)
    .map(s => s.text);

  try {
    const res = await fetch(`${gatewayUrl}/inference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sim-tenant-id': tenantId,
        'x-sim-cell-boundary': input.cell_boundary,
      },
      body: JSON.stringify({
        task_kind: 'extract_entities',
        prompt_ref: input.prompt_ref,
        prompt_version: input.prompt_version,
        model_binding_ref: input.model_binding_ref,
        model_binding_version: input.model_binding_version,
        inputs: {
          document_span_refs: docSpanRefs,
          text_segments: textSegments,
          entity_schema_ref: 'schema:us-core-v6',
          clinical_context: {},
        },
        workflow_id: input.analysis_id,
      }),
    });

    if (!res.ok) return { status: 'abstained', resources: [] };

    const { output } = (await res.json()) as {
      output: {
        entities: Array<{
          resource_type: string;
          raw_text: string;
          coding_hint: string | null;
          span_ref: string;
        }>;
      };
    };

    const resources = output.entities.map((e, i) => ({
      fabric_ref: `fabric/${e.resource_type}/extracted_${i}`,
      resource_type: e.resource_type,
      provenance_ref: 'trc_pending',
      normalization: normalizeEntity({
        resource_type: e.resource_type,
        raw_text: e.raw_text,
        coding_hint: e.coding_hint,
      }).normalization,
      confidence: 0.88,
    }));

    return { status: 'ok', resources };
  } catch {
    return { status: 'abstained', resources: [] };
  }
}

const GATEWAY_URL = process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:4060';

export async function extractEntities(
  spanMap: SpanMap,
  input: AnalysisInput,
): Promise<ExtractionBlock> {
  const tenantId = input.tenant_id;
  return extractEntitiesImpl(spanMap, input, GATEWAY_URL, tenantId);
}
