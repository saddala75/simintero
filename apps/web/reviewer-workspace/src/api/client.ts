import { currentBearer } from '../auth/keycloak'

export interface ClinicalEntity {
  id: string
  type: 'condition' | 'procedure' | 'observation'
  name: string
  code: string
  system: string
  confidence: number
  provenance: string
  status: 'accepted' | 'disputed' | 'pending'
  citationId?: string
}

export interface GroundednessMetric {
  score: number
  citationsCount: number
  gapsCount: number
  conflictsCount: number
}

export interface CitationSpan {
  id: string
  page: number
  text: string
  bbox: string
}

export interface WorkbenchCaseDetail {
  caseId: string
  memberName: string
  memberDob: string
  serviceRequested: string
  documentUrl: string | null
  entities: ClinicalEntity[]
  citations: CitationSpan[]
  groundedness: GroundednessMetric
  summary: string
  completeness: Array<{ criteria: string; satisfied: boolean; note: string }>
}

export interface WorklistItem {
  case_id: string
  member_name: string
  service_description: string
  lob: string
  status: string
  urgency: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const bearer = currentBearer()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export function getWorkbenchCase(caseId: string): Promise<WorkbenchCaseDetail> {
  return apiFetch<WorkbenchCaseDetail>(`/bff/cases/${caseId}/workbench`)
}

export function updateEntityStatus(
  caseId: string,
  entityId: string,
  status: 'accepted' | 'disputed' | 'pending',
): Promise<{ status: string }> {
  return apiFetch(`/bff/cases/${caseId}/entities/${entityId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function submitDetermination(
  caseId: string,
  decision: 'accept' | 'adverse',
): Promise<{ status: string }> {
  return apiFetch(`/bff/cases/${caseId}/determination`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}

export function getWorklist(): Promise<WorklistItem[]> {
  return apiFetch<{ items: WorklistItem[] }>(
    '/bff/queues/default/worklist?page=1&page_size=50',
  ).then(d => d.items)
}
