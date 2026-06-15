export interface SlaInfo {
  deadline: string
  hours_remaining: number
  rag: 'green' | 'amber' | 'red'
  paused: boolean
}

export interface WorklistItem {
  case_id: string
  member_name: string
  service_description: string
  lob: string
  status: string
  urgency: string
  sla: SlaInfo | null
}

export interface WorklistPage {
  items: WorklistItem[]
  total: number
  page: number
  page_size: number
}

export type AdverseOutcome = 'denied' | 'partially_denied' | 'adverse_modification'

export interface FindingSection {
  criterion_id: string
  text: string
  status: 'gap' | 'unknown'
}

export interface AdverseStructuredPayload {
  finding_sections: FindingSection[]
  reason_codes: string[]
  citations: string[]
}

export interface QueueStats {
  ai_determinations: number
  adverse_human_signed_pct: number
  sla_compliance_expedited_pct: number
  period_start: string
  period_end: string
}

export interface CaseDetail {
  case_id: string
  tenant_id: string
  status: string
  urgency: string
  lob: string
  member: Record<string, unknown>
  coverage: Record<string, unknown>
  service_lines: Record<string, unknown>[]
  events: Record<string, unknown>[]
  sla: SlaInfo | null
}

export interface DocumentItem {
  id: string
  title: string
  doc_type: string
  content_type: string
  url: string
  authored: string | null
}

export interface CriterionItem {
  id: string
  criterion_id: string
  text: string
  status: 'met' | 'gap' | 'unknown'
  evidence: { title: string; meta: string } | null
  citations: string[]
}

export interface SuggestionItem {
  id: string
  agent_id: string
  title: string
  body: string
  confidence: number
  citations: string[]
  status: 'pending' | 'accepted' | 'rejected'
  reviewer_id: string | null
  reviewed_at: string | null
}

export interface CrdCardLink {
  label: string
  url: string
  type: string
  appContext?: string
}

export interface CrdCard {
  summary: string
  indicator: string
  detail?: string
  links?: CrdCardLink[]
}
