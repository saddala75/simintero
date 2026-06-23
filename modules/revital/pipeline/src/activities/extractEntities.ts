import { normalizeEntity } from '@sim/revital-extraction';
import type { NormalizedResult, TerminologyLookup } from '@sim/revital-extraction';
import type { SpanMap } from './parseSegment.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

export interface ExtractionBlock {
  status: 'ok' | 'abstained';
  resources: Array<{
    fabric_ref: string;
    resource_type: string;
    provenance_ref: string;
    normalization: NormalizedResult;
    confidence?: number;
  }>;
}

/**
 * Best-effort terminology lookup against terminology-service ($validate-code /
 * $find-code). If TERMINOLOGY_URL is unset or a call fails, lookups resolve to
 * false/null so entities fall through to uncoded — dev without terminology works.
 */
function makeTerminologyLookup(): TerminologyLookup {
  const base = process.env['TERMINOLOGY_URL'];
  return {
    async validateCode(system: string, code: string) {
      if (!base) return false;
      try {
        // $validate-code requires a value-set `url`; without a derivable one we
        // cannot scope the check, so report best-effort false (the model code is
        // still used by normalizeEntity's model-hint path regardless).
        const url = `${base}/fhir/ValueSet/$validate-code?system=${encodeURIComponent(system)}&code=${encodeURIComponent(code)}`;
        const res = await fetch(url);
        if (!res.ok) return false;
        const body = (await res.json()) as {
          parameter?: Array<{ name: string; valueBoolean?: boolean; valueString?: string }>;
        };
        const result = body.parameter?.find(p => p.name === 'result')?.valueBoolean ?? false;
        const display = body.parameter?.find(p => p.name === 'display')?.valueString;
        return display !== undefined ? { valid: result, display } : result;
      } catch {
        return false;
      }
    },
    async findCode(text: string) {
      if (!base) return null;
      try {
        const url = `${base}/fhir/ValueSet/$find-code?text=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const body = (await res.json()) as {
          found: boolean;
          system?: string;
          code?: string;
          display?: string;
        };
        if (body.found && body.system && body.code) {
          return { system: body.system, code: body.code, display: body.display ?? '' };
        }
        return null;
      } catch {
        return null;
      }
    },
  };
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

    const { output, request_id } = (await res.json()) as {
      output: {
        entities: Array<{
          resource_type: string;
          raw_text: string;
          coding_hint: string | null;
          span_ref: string;
          confidence?: number;
        }>;
      };
      request_id: string;
    };

    const lookup = makeTerminologyLookup();
    const resources = await Promise.all(
      output.entities.map(async (e, i) => ({
        fabric_ref: `fabric/${e.resource_type}/extracted_${i}`,
        resource_type: e.resource_type,
        provenance_ref: request_id,
        normalization: await normalizeEntity(
          {
            resource_type: e.resource_type,
            raw_text: e.raw_text,
            coding_hint: e.coding_hint,
          },
          lookup,
        ),
        ...(e.confidence != null ? { confidence: e.confidence } : {}),
      })),
    );

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
