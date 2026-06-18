import type { SummaryBlock } from './summarizeGrounded.js';
import type { CompletenessBlock } from './mapEvidenceToCriteria.js';
import type { AnalysisInput } from '../workflows/RevitalAnalyzeCase.js';

// HUMAN_REVIEW: this threshold requires clinical safety review before any change.
const CONFIDENCE_THRESHOLD = 0.7;

export interface TriageBlock {
  status: 'ok' | 'abstained';
  suggestion?: 'likely_meets' | 'needs_rfi' | 'route_to_clinician';
  confidence?: number;
  calibration_ref?: string;
  rationale_assertion_ids?: string[];
}

export async function triageAdviseImpl(
  summary: SummaryBlock | null,
  completeness: CompletenessBlock | null,
  input: AnalysisInput,
  gatewayUrl: string,
  tenantId: string,
): Promise<TriageBlock> {
  const gapRefs = completeness?.gaps.map(g => g.requirement_id) ?? [];
  const resourceRefs = summary?.assertions.flatMap(a => a.citations.map(c => c.document_ref)) ?? [];

  try {
    const res = await fetch(`${gatewayUrl}/inference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sim-tenant-id': tenantId,
        'x-sim-cell-boundary': input.cell_boundary,
      },
      body: JSON.stringify({
        task_kind: 'triage_advise',
        prompt_ref: input.prompt_ref,
        prompt_version: input.prompt_version,
        model_binding_ref: input.model_binding_ref,
        model_binding_version: input.model_binding_version,
        inputs: {
          requirement_gap_refs: gapRefs,
          extracted_resource_refs: resourceRefs,
          confidence_context: {},
        },
        workflow_id: input.analysis_id,
      }),
    });

    if (!res.ok) return { status: 'abstained' };

    const { output } = (await res.json()) as {
      output: {
        suggestion: 'likely_meets' | 'needs_rfi' | 'route_to_clinician';
        confidence: number;
        rationale_assertion_ids: string[];
      };
    };

    // INV-3: confidence below threshold → abstain
    if (output.confidence < CONFIDENCE_THRESHOLD) {
      return { status: 'abstained' };
    }

    return {
      status: 'ok',
      suggestion: output.suggestion,
      confidence: output.confidence,
      calibration_ref: 'evalset:pa-triage@2026Q2',
      rationale_assertion_ids: output.rationale_assertion_ids,
    };
  } catch {
    return { status: 'abstained' };
  }
}

const GATEWAY_URL = process.env['MODEL_GATEWAY_URL'] ?? 'http://localhost:4060';

export async function triageAdvise(
  summary: SummaryBlock | null,
  completeness: CompletenessBlock | null,
  input: AnalysisInput,
): Promise<TriageBlock> {
  const tenantId = input.tenant_id;
  return triageAdviseImpl(summary, completeness, input, GATEWAY_URL, tenantId);
}
