// HUMAN_REVIEW: gap detection thresholds require quality measurement specialist review.
// Do not adjust these values autonomously.
const MIN_EVIDENCE_CONFIDENCE = 0.0; // HUMAN_REVIEW

// Suppress unused variable warning — value is intentionally zero pending specialist review.
void MIN_EVIDENCE_CONFIDENCE;

export interface GapInput {
  run_id: string;
  member_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
  numerator: boolean;
  denominator: boolean;
  exclusion: boolean;
}

export interface GapDecision {
  has_gap: boolean;
  gap_type: 'missing_numerator' | 'exclusion_opportunity' | null;
  should_create_outreach: boolean;
}

export function detectGap(input: GapInput): GapDecision {
  if (!input.denominator || input.exclusion) {
    return { has_gap: false, gap_type: null, should_create_outreach: false };
  }
  if (input.numerator) {
    return { has_gap: false, gap_type: null, should_create_outreach: false };
  }
  return {
    has_gap: true,
    gap_type: 'missing_numerator',
    should_create_outreach: true,
  };
}
