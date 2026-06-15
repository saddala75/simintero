import type { AdverseOutcome, AdverseStructuredPayload, CaseDetail, CrdCard, CriterionItem, DocumentItem, QueueStats, SuggestionItem, WorklistPage } from '../types'

const BASE = '/bff'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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

export function getCriteria(caseId: string): Promise<CriterionItem[]> {
  return apiFetch<CriterionItem[]>(`/cases/${caseId}/criteria`)
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
