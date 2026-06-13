export type CaseState = 'RECEIVED' | 'IN_REVIEW' | 'PENDING_INFO' | 'APPROVED' | 'DENIED' | 'MODIFIED';
export type Urgency = 'standard' | 'expedited';
export type ClockState = 'running' | 'warning' | 'breached';
export type DeterminationOutcome = 'approved' | 'denied' | 'modified' | 'partial';
export type AdvisoryStatus = 'not_available' | 'available' | 'processing' | 'complete' | 'partial' | 'failed';

export interface CaseListItem {
  case_id: string;
  urgency: Urgency;
  state: CaseState;
  member_ref: string;
  lob: string;
  clock?: {
    state: ClockState;
    deadline: string;
  };
}

export interface ServiceLine {
  line_id: string;
  code: { code: string; system: string };
  qty: number;
  status: string;
  place_of_service?: string;
}

export interface TraceCriterion {
  expression_name: string;
  result: boolean | 'indeterminate';
  artifact_canonical_url: string;
  artifact_version: string;
}

export interface AdvisoryResult {
  status: AdvisoryStatus;
  analysis: string | null;
}

// C-2 Advisory result shape (used by AdvisoryPanel)
export interface Citation {
  documentRef: string;
  page: number;
  region: number[];
  excerptHash: string;
}

export interface Assertion {
  id: string;
  text: string;
  citations: Citation[];
  confidence: number;
}

export interface SummaryBlock {
  status: 'ok' | 'abstained';
  assertions?: Assertion[];
  abstainReason?: string | null;
}

export interface TriageBlock {
  status: 'ok' | 'abstained';
  suggestion?: 'likely_meets' | 'needs_rfi' | 'route_to_clinician';
  confidence?: number;
}

export interface AdvisoryAnalysisResult {
  analysisId: string;
  classification: 'advisory';
  status: 'complete' | 'partial' | 'failed';
  summary?: SummaryBlock;
  triage?: TriageBlock;
  abstentions?: Array<{ block: string; reason: string }>;
}
