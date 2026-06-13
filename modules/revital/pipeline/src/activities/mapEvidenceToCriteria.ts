import type { ExtractionBlock } from './extractEntities.js';
import type { RequirementsResult } from './fetchEvidenceRequirements.js';

export interface CompletenessBlock {
  status: 'ok' | 'abstained';
  against: {
    requirements_trace_ref: string;
    pins: Array<{ canonical_url: string; version: string }>;
  };
  satisfied: Array<{ requirement_id: string; evidence_refs: string[] }>;
  gaps: Array<{ requirement_id: string; description: string; search_attempted: boolean }>;
  conflicts: Array<{ description: string; refs: string[] }>;
}

export function mapEvidenceToCriteriaImpl(
  extraction: ExtractionBlock,
  requirements: RequirementsResult,
): CompletenessBlock {
  if (extraction.status === 'abstained') {
    return {
      status: 'abstained',
      against: { requirements_trace_ref: requirements.trace_ref, pins: requirements.pins },
      satisfied: [],
      gaps: [],
      conflicts: [],
    };
  }

  const satisfied: CompletenessBlock['satisfied'] = [];
  const gaps: CompletenessBlock['gaps'] = [];

  for (const req of requirements.requirements) {
    const matching = extraction.resources.filter(r =>
      req.evidence_types.includes(r.resource_type),
    );
    if (matching.length > 0) {
      satisfied.push({
        requirement_id: req.id,
        evidence_refs: matching.map(r => r.fabric_ref),
      });
    } else {
      gaps.push({
        requirement_id: req.id,
        description: req.description,
        search_attempted: true,
      });
    }
  }

  return {
    status: 'ok',
    against: { requirements_trace_ref: requirements.trace_ref, pins: requirements.pins },
    satisfied,
    gaps,
    conflicts: [],
  };
}

export async function mapEvidenceToCriteria(
  extraction: ExtractionBlock,
  requirements: RequirementsResult,
): Promise<CompletenessBlock> {
  return mapEvidenceToCriteriaImpl(extraction, requirements);
}
