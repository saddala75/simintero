import type { ExtractionBlock } from './extractEntities.js';
import type { RequirementsResult, CodeRef } from './fetchEvidenceRequirements.js';

export interface CompletenessBlock {
  status: 'ok' | 'abstained';
  against: { requirements_trace_ref: string; pins: Array<{ canonical_url: string; version: string }> };
  satisfied: Array<{ requirement_id: string; evidence_refs: string[] }>;
  gaps: Array<{ requirement_id: string; description: string; search_attempted: boolean }>;
  conflicts: Array<{ description: string; refs: string[]; kind: 'negation' | 'contradiction' }>;
}

type Resource = ExtractionBlock['resources'][number];

function codeMatches(set: CodeRef[] | undefined, r: Resource): boolean {
  if (!set || set.length === 0) return false;
  const n: any = r.normalization;
  if (!n?.coded) return false;
  return set.some((c) => c.system === n.system && c.code === n.code);
}

/** Cited evidence refs: fabric_ref + provenance_ref per resource (INV-2). */
function refsOf(resources: Resource[]): string[] {
  return resources.flatMap((r) => [r.fabric_ref, r.provenance_ref]);
}

export function mapEvidenceToCriteriaImpl(
  extraction: ExtractionBlock,
  requirements: RequirementsResult,
): CompletenessBlock {
  const against = { requirements_trace_ref: requirements.trace_ref, pins: requirements.pins };
  if (extraction.status === 'abstained') {
    return { status: 'abstained', against, satisfied: [], gaps: [], conflicts: [] };
  }

  const satisfied: CompletenessBlock['satisfied'] = [];
  const gaps: CompletenessBlock['gaps'] = [];
  const conflicts: CompletenessBlock['conflicts'] = [];

  for (const req of requirements.requirements) {
    const byType = extraction.resources.filter((r) => (req.evidence_types ?? []).includes(r.resource_type));
    const enriched = (req.codes?.length ?? 0) > 0 || (req.negates?.length ?? 0) > 0;

    const affirmers = enriched ? byType.filter((r) => codeMatches(req.codes, r)) : byType;
    const negaters = enriched ? byType.filter((r) => codeMatches(req.negates, r)) : [];

    if (affirmers.length > 0) {
      satisfied.push({ requirement_id: req.id, evidence_refs: refsOf(affirmers) });
    } else if (req.required !== false && negaters.length === 0) {
      gaps.push({ requirement_id: req.id, description: req.description, search_attempted: true });
    }

    if (negaters.length > 0) {
      conflicts.push({
        kind: 'negation',
        description: `Evidence contradicts requirement ${req.id}`,
        refs: refsOf(negaters),
      });
      if (affirmers.length > 0) {
        conflicts.push({
          kind: 'contradiction',
          description: `Conflicting evidence for requirement ${req.id}`,
          refs: refsOf([...affirmers, ...negaters]),
        });
      }
    }
  }

  return { status: 'ok', against, satisfied, gaps, conflicts };
}

export async function mapEvidenceToCriteria(
  extraction: ExtractionBlock,
  requirements: RequirementsResult,
): Promise<CompletenessBlock> {
  return mapEvidenceToCriteriaImpl(extraction, requirements);
}
