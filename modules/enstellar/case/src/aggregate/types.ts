import type { CaseStatus } from '@sim/canonical-types';
export type { CaseStatus };

export interface CaseState {
  caseId: string; // UUID string
  tenantId: string;
  status: CaseStatus;
  urgency: 'standard' | 'expedited';
  channel: string;
  lob: string;
  memberRef: string | null;
  coverageRef: string | null;
  pins: Array<{ canonical_url: string; version: string }>;
  linked: { appeal_of: string | null; related_cases: string[] };
  events: CaseEvent[]; // accumulated for replay
}

// Event union — all carry case_id, tenant_id, occurred_at, actor
export type CaseEvent =
  | { type: 'CaseCreated'; case_id: string; payload: Record<string, unknown> }
  | { type: 'CaseStateChanged'; case_id: string; to: CaseStatus; trigger: string; payload: Record<string, unknown> }
  | { type: 'DeterminationRecorded'; case_id: string; outcome: string; payload: Record<string, unknown> }
  | { type: 'PinAppended'; case_id: string; canonical_url: string; version: string; payload: Record<string, unknown> }
  | { type: 'RfiIssued'; case_id: string; rfi_id: string; payload: Record<string, unknown> }
  | { type: 'RfiSatisfied'; case_id: string; rfi_id: string; payload: Record<string, unknown> }
  | { type: 'CaseLinked'; case_id: string; payload: Record<string, unknown> };

export type DeterminationOutcome =
  | 'approved'
  | 'partially_approved'
  | 'denied'
  | 'modified';

export interface DeterminationDecidedBy {
  type: 'human' | 'service' | 'model_agent';
  id: string;
  role?: string;
}

export interface RecordDecisionInput {
  caseId: string;
  outcome: DeterminationOutcome;
  decidedBy: DeterminationDecidedBy;
  perLine?: Record<string, unknown>[];
  autoPath?: boolean;
  rationaleRef?: string;
  rulesTraceRef?: string;
  advisoryAnalysisRef?: string;
  pins?: Record<string, unknown>[];
  supersedes?: string;
}

export interface CreateCaseInput {
  channel: 'PAS' | 'X12_278' | 'PORTAL' | 'FAX_OCR';
  urgency: 'standard' | 'expedited';
  lob: string;
  memberRef?: string;
  coverageRef?: string;
  origin?: Record<string, unknown>;
  providers?: Record<string, unknown>;
}

export interface RecordRFIInput {
  rfiId: string;
  caseId: string;
  requirementIds: string[];
  channel: string;
  issuedAt: string; // ISO-8601
  dueBy: string; // ISO-8601
}

export interface SatisfyRFIInput {
  rfiId: string;
  caseId: string;
  satisfiedBy?: Record<string, unknown>[];
}

export interface AppendPinInput {
  caseId: string;
  canonicalUrl: string;
  version: string;
}

export interface LinkCaseInput {
  caseId: string;
  appealOf?: string | null;
  relatedCases?: string[];
}
