import type { SpanMap, Span } from './parseSegment.js';
import type { CompletenessBlock } from './mapEvidenceToCriteria.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

// HUMAN_REVIEW: do not change this threshold without eval review sign-off.
const ABSTAIN_IF_CITATION_ATTEMPT_COUNT = 2;

export interface CitedAssertion {
  id: string;
  text: string;
  citations: Array<{
    document_ref: string;
    page: number;
    region: [number, number, number, number];
    excerpt_hash: string;
    trace_ref: string;
  }>;
  confidence: number;
}

export interface SummaryBlock {
  status: 'ok' | 'abstained';
  abstain_reason: string | null;
  assertions: CitedAssertion[];
}

function isCitationValid(
  citation: { document_ref: string; page: number },
  spanMap: SpanMap,
): boolean {
  const spans: Span[] = spanMap[citation.document_ref] ?? [];
  return spans.some(s => s.page === citation.page);
}

export async function summarizeGroundedImpl(
  spanMap: SpanMap,
  completeness: CompletenessBlock | null,
  input: AnalysisInput,
  gatewayUrl: string,
  tenantId: string,
): Promise<SummaryBlock> {
  const docSpanRefs = Object.keys(spanMap);
  const criteriaRefs = completeness?.gaps.map(g => g.requirement_id) ?? [];

  for (let attempt = 0; attempt < ABSTAIN_IF_CITATION_ATTEMPT_COUNT; attempt++) {
    try {
      const res = await fetch(`${gatewayUrl}/inference`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sim-tenant-id': tenantId,
          'x-sim-cell-boundary': input.cell_boundary,
        },
        body: JSON.stringify({
          task_kind: 'summarize',
          prompt_ref: input.prompt_ref,
          prompt_version: input.prompt_version,
          model_binding_ref: input.model_binding_ref,
          model_binding_version: input.model_binding_version,
          inputs: {
            document_span_refs: docSpanRefs,
            section_labels: ['Clinical History', 'Treatment'],
            criteria_requirement_refs: criteriaRefs,
          },
          workflow_id: input.analysis_id,
        }),
      });

      if (!res.ok) {
        return { status: 'abstained', abstain_reason: `gateway_${res.status}`, assertions: [] };
      }

      const { output } = (await res.json()) as {
        output: {
          assertions: Array<{
            id: string;
            text: string;
            citations: Array<{
              document_ref: string;
              page: number;
              region: [number, number, number, number];
              excerpt_hash: string;
            }>;
            confidence: number;
          }>;
        };
      };

      // INV-2: drop assertions with zero citations or citations that don't resolve in SpanMap
      const cited: CitedAssertion[] = output.assertions
        .filter(a => a.citations.length >= 1 && a.citations.every(c => isCitationValid(c, spanMap)))
        .map(a => ({
          ...a,
          citations: a.citations.map(c => ({ ...c, trace_ref: 'trc_pending' })),
        }));

      if (cited.length > 0) {
        return { status: 'ok', abstain_reason: null, assertions: cited };
      }
      // All assertions dropped — retry
    } catch {
      return { status: 'abstained', abstain_reason: 'gateway_error', assertions: [] };
    }
  }

  return { status: 'abstained', abstain_reason: 'all_assertions_uncited', assertions: [] };
}

const GATEWAY_URL = process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:4060';

export async function summarizeGrounded(
  spanMap: SpanMap,
  completeness: CompletenessBlock | null,
  input: AnalysisInput,
): Promise<SummaryBlock> {
  const tenantId = process.env['SIM_TENANT_ID'] ?? 'unknown';
  return summarizeGroundedImpl(spanMap, completeness, input, GATEWAY_URL, tenantId);
}
