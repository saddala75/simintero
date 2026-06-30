import type { AdverseOutcome, AdverseStructuredPayload, AppealDecisionPayload, AppealDetail, AppealFilingPayload, AppealItem, CaseDetail, CrdCard, CriterionItem, DocumentItem, GrievanceDetail, GrievanceFilingPayload, GrievanceItem, GrievanceResolutionPayload, QueueStats, SuggestionItem, WorklistPage } from '../types'
import { currentBearer, keycloak, IS_MOCK } from '../auth/keycloak'

export interface WorkbenchCaseDetail {
  caseId: string
  memberName: string
  memberDob: string
  serviceRequested: string
  documentUrl: string | null
  entities: Array<{
    id: string; type: string; name: string; code: string
    system: string; confidence: number; provenance: string
    status: 'accepted' | 'disputed' | 'pending'; citationId?: string
  }>
  citations: Array<{ id: string; page: number; text: string; bbox: string }>
  groundedness: { score: number; citationsCount: number; gapsCount: number; conflictsCount: number }
  summary: string
  completeness: Array<{ criteria: string; satisfied: boolean; note: string }>
}

const BASE = '/bff'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Real mode: refresh the token if it expires within 30s, so we never send a
  // stale bearer. Swallow refresh failures (the existing token may still be valid;
  // a hard 401 surfaces below). Mock mode skips this (no real keycloak).
  if (!IS_MOCK && keycloak.authenticated) {
    try { await keycloak.updateToken(30) } catch { /* fall through with current token */ }
  }
  const bearer = currentBearer()
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...init?.headers,
    },
  })
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`)
  }
  return r.json() as Promise<T>
}

export function getWorklist(queueId: string, page = 1): Promise<WorklistPage> {
  return apiFetch<WorklistPage>(
    `/queues/${queueId}/worklist?page=${page}&page_size=25`,
  )
}

export function getQueueStats(queueId: string): Promise<QueueStats> {
  return apiFetch<QueueStats>(`/queues/${queueId}/stats`)
}

export function getCase(caseId: string): Promise<CaseDetail> {
  return apiFetch<CaseDetail>(`/cases/${caseId}`)
}

export function submitAdverseDecision(
  caseId: string,
  outcome: AdverseOutcome,
  reason: string,
  clinicianId: string,
  structured?: AdverseStructuredPayload,
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/adverse-decision`, {
    method: 'POST',
    body: JSON.stringify({
      outcome,
      reason,
      clinician_id: clinicianId,
      sign_off_confirmed: true,
      ...(structured ?? {}),
    }),
  })
}

export function submitDecision(
  caseId: string,
  outcome: 'approved' | 'escalate',
  reason?: string,
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ outcome, reason }),
  })
}

export function postRfi(
  caseId: string,
  body: { question: string; requested_docs: string[] },
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/cases/${caseId}/rfi`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getCaseDocuments(caseId: string): Promise<DocumentItem[]> {
  return apiFetch<DocumentItem[]>(`/cases/${caseId}/documents`)
}

export function getDocumentContent(
  documentId: string,
): Promise<{ id: string; title: string; body: string }> {
  return apiFetch<{ id: string; title: string; body: string }>(
    `/documents/${documentId}/content`,
  )
}

export function getCriteria(caseId: string): Promise<CriterionItem[]> {
  return apiFetch<CriterionItem[]>(`/cases/${caseId}/criteria`)
}

export function getNoticePreview(caseId: string): Promise<{ body: string }> {
  return apiFetch<{ body: string }>(`/cases/${caseId}/notice-preview`)
}

export function getSuggestions(caseId: string): Promise<SuggestionItem[]> {
  return apiFetch<SuggestionItem[]>(`/cases/${caseId}/suggestions`)
}

export function postCrdHook(body: {
  hook: 'order-select' | 'order-sign' | 'appointment-book'
  service_code: string
  patient_id: string
  plan_id: string
}): Promise<CrdCard[]> {
  return apiFetch<CrdCard[]>('/crd/invoke', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getDtrQuestionnaire(context: string, plan: string): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    `/dtr/questionnaire?context=${encodeURIComponent(context)}&plan=${encodeURIComponent(plan)}`,
  )
}

export function postQuestionnaireResponse(qr: unknown): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>('/dtr/questionnaire-response', {
    method: 'POST',
    body: JSON.stringify(qr),
  })
}

export function postSuggestionAction(
  caseId: string,
  suggestionId: string,
  action: 'accepted' | 'rejected',
): Promise<unknown> {
  return apiFetch(`/cases/${caseId}/suggestions/${suggestionId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function fileAppeal(
  caseId: string,
  payload: AppealFilingPayload,
): Promise<{ appeal_id: string }> {
  return apiFetch<{ appeal_id: string }>(`/cases/${caseId}/appeals`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getAssignedAppeals(): Promise<AppealItem[]> {
  return apiFetch<AppealItem[]>('/appeals/assigned')
}

export function getOpenAppeals(): Promise<AppealItem[]> {
  return apiFetch<AppealItem[]>('/appeals/open')
}

export function getAppealDetail(
  caseId: string,
  appealId: string,
): Promise<AppealDetail> {
  return apiFetch<AppealDetail>(`/cases/${caseId}/appeals/${appealId}`)
}

export function submitAppealDecision(
  caseId: string,
  appealId: string,
  payload: AppealDecisionPayload,
): Promise<unknown> {
  return apiFetch<unknown>(`/cases/${caseId}/appeals/${appealId}/decision`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function assignAppeal(
  caseId: string,
  appealId: string,
  coordinatorId: string,
): Promise<unknown> {
  return apiFetch<unknown>(`/cases/${caseId}/appeals/${appealId}/assignment`, {
    method: 'POST',
    body: JSON.stringify({ coordinator_id: coordinatorId }),
  })
}

export function fileGrievance(payload: GrievanceFilingPayload): Promise<{ grievance_id: string; status: string }> {
  return apiFetch('/grievances', { method: 'POST', body: JSON.stringify(payload) })
}

export function getAssignedGrievances(): Promise<GrievanceItem[]> {
  return apiFetch('/grievances/assigned')
}

export function getGrievanceDetail(grievanceId: string): Promise<GrievanceDetail> {
  return apiFetch(`/grievances/${grievanceId}`)
}

export function acknowledgeGrievance(grievanceId: string): Promise<{ grievance_id: string; status: string }> {
  return apiFetch(`/grievances/${grievanceId}/acknowledgement`, { method: 'POST' })
}

export function assignInvestigator(grievanceId: string, investigatorId: string): Promise<{ grievance_id: string; assigned_to: string; status: string }> {
  return apiFetch(`/grievances/${grievanceId}/assignment`, { method: 'POST', body: JSON.stringify({ investigator_id: investigatorId }) })
}

export function resolveGrievance(grievanceId: string, payload: GrievanceResolutionPayload): Promise<{ grievance_id: string; status: string }> {
  return apiFetch(`/grievances/${grievanceId}/resolution`, { method: 'POST', body: JSON.stringify(payload) })
}

export function getWorkbenchCase(caseId: string): Promise<WorkbenchCaseDetail> {
  return apiFetch<WorkbenchCaseDetail>(`/cases/${caseId}/workbench`)
}

export interface AiPerformanceSummary {
  total_reviewed: number
  avg_groundedness: number
  avg_completeness_rate: number
  citation_acceptance_rate: number
  alignment_rate: number
  cases_needing_review: number
}

export interface AiCaseRecord {
  case_id: string
  member_name: string
  service: string
  groundedness: number
  citations_count: number
  gaps_count: number
  conflicts_count: number
  ai_recommendation: 'approve' | 'deny' | null
  human_decision: string
  aligned: boolean | null
  reviewed_at: string
}

export interface AiPerformanceData {
  summary: AiPerformanceSummary
  recent_cases: AiCaseRecord[]
  top_evidence_sources: Array<{ title: string; citations: number; cases: number }>
  weekly_trend: Array<{ week: string; cases: number; avg_groundedness: number }>
}

export function getAiPerformance(): Promise<AiPerformanceData> {
  return apiFetch<AiPerformanceData>('/ai/performance')
}

export interface MeasureBenchmarks {
  p25: number
  p50: number
  p75: number
  p90: number
  national_avg: number
}

export interface MeasureCatalogItem {
  id: string
  code: string
  program: 'HEDIS' | 'CMS Stars' | 'QRS' | 'Medicaid'
  domain: string
  name: string
  description: string
  numerator_desc: string
  denominator_desc: string
  reporting_period: string
  source_version: string
  benchmarks: MeasureBenchmarks
  active: boolean
}

export function getMeasureLibrary(): Promise<MeasureCatalogItem[]> {
  return apiFetch<MeasureCatalogItem[]>('/measures/library')
}

export function activateMeasure(id: string): Promise<{ id: string; active: boolean }> {
  return apiFetch<{ id: string; active: boolean }>(`/measures/library/${id}/activate`, { method: 'POST' })
}

export function deactivateMeasure(id: string): Promise<{ id: string; active: boolean }> {
  return apiFetch<{ id: string; active: boolean }>(`/measures/library/${id}/deactivate`, { method: 'POST' })
}

export interface DashboardMyCase {
  case_id: string
  member_name: string
  lob: string
  request_type: string
  priority: 'urgent' | 'normal'
  sla_remaining_hours: number
  status: string
}

export interface DashboardActivity {
  time: string
  actor: string
  action: string
  case_id: string
  member_name: string
}

export interface DashboardData {
  queue: { total_open: number; urgent: number; sla_at_risk: number; avg_age_hours: number }
  my_cases: DashboardMyCase[]
  appeals: { open: number; overdue: number }
  grievances: { open: number; unacknowledged: number }
  ai: { avg_groundedness: number; cases_reviewed_today: number; cases_with_gaps: number }
  policies: { active: number; drafts_pending: number; elm_compliance: number }
  quality: { active_measures: number; care_gaps_open: number; top_gap_measure: string }
  recent_activity: DashboardActivity[]
}

export function getDashboard(): Promise<DashboardData> {
  return apiFetch<DashboardData>('/dashboard')
}
