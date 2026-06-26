import type { AdverseOutcome, AdverseStructuredPayload, CaseDetail, CrdCard, CriterionItem, DocumentItem, QueueStats, SuggestionItem, WorklistPage } from '../types'
import { currentBearer, keycloak, IS_MOCK } from '../auth/keycloak'

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
