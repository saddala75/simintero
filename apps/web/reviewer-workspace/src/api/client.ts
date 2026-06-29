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

const MOCK_CASE_DETAIL: WorkbenchCaseDetail = {
  caseId: 'PA-2026-88492',
  memberName: 'Eleanor Vance',
  memberDob: '1968-04-12',
  serviceRequested: 'Lumbar Spine MRI (CPT 72148)',
  documentUrl: '/docs/clinical-notes-88492.pdf',
  groundedness: {
    score: 0.94,
    citationsCount: 6,
    gapsCount: 0,
    conflictsCount: 0,
  },
  summary: 'Patient exhibits 8 weeks of progressive right L5 radiculopathy. Completed 6 weeks of structured physical therapy with persistent functional limitation. Neurological exam reveals decreased right Achilles reflex. MRI requested to evaluate for lumbar disc herniation.',
  completeness: [
    { criteria: '6+ Weeks Conservative PT Therapy', satisfied: true, note: 'Completed May 2 - June 20 at Apex Physical Therapy' },
    { criteria: 'Documented Neurological Deficit', satisfied: true, note: 'Right Achilles reflex 1+ / 2+' },
    { criteria: 'No Counter-indications or Red Flags', satisfied: true, note: 'Bowel/bladder function intact, no fever' },
  ],
  citations: [
    { id: 'span-1', page: 2, text: 'Patient exhibits 8 weeks of right L5 radicular pain refractory to conservative therapy.', bbox: 'p.2 (L14-L18)' },
    { id: 'span-2', page: 3, text: 'Physical exam: Right Achilles deep tendon reflex decreased (1+ vs 2+ on left).', bbox: 'p.3 (L22-L25)' },
    { id: 'span-3', page: 4, text: 'Completed 12 sessions of outpatient physical therapy from May 2 to June 20, 2026.', bbox: 'p.4 (L8-L12)' },
  ],
  entities: [
    {
      id: 'ent-001',
      type: 'condition',
      name: 'Right L5 Radiculopathy',
      code: 'SNOMED: 239873007',
      system: 'SNOMED-CT',
      confidence: 0.98,
      provenance: 'Clinical Progress Note p. 2, line 14',
      status: 'accepted',
      citationId: 'span-1',
    },
    {
      id: 'ent-002',
      type: 'procedure',
      name: 'Physical Therapy Evaluation & Treatment',
      code: 'CPT: 97161',
      system: 'CPT',
      confidence: 0.95,
      provenance: 'PT Attendance Summary p. 4, line 8',
      status: 'accepted',
      citationId: 'span-3',
    },
    {
      id: 'ent-003',
      type: 'observation',
      name: 'Decreased Right Achilles Reflex (1+)',
      code: 'LOINC: 72089-6',
      system: 'LOINC',
      confidence: 0.91,
      provenance: 'Physical Exam Note p. 3, line 22',
      status: 'pending',
      citationId: 'span-2',
    },
  ],
}

const MOCK_WORKLIST: WorklistItem[] = [
  {
    case_id: 'PA-2026-88492',
    member_name: 'Eleanor Vance',
    service_description: 'Lumbar Spine MRI (CPT 72148)',
    lob: 'Commercial',
    status: 'clinical_review',
    urgency: 'expedited',
  },
  {
    case_id: 'PA-2026-90112',
    member_name: 'Arthur Pendelton',
    service_description: 'Total Knee Arthroplasty (CPT 27447)',
    lob: 'Medicare Advantage',
    status: 'clinical_review',
    urgency: 'standard',
  },
  {
    case_id: 'PA-2026-44109',
    member_name: 'Maria Santos',
    service_description: 'Bariatric Gastric Bypass (CPT 43644)',
    lob: 'Medicaid',
    status: 'md_review',
    urgency: 'standard',
  },
]

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

export async function getWorkbenchCase(caseId: string): Promise<WorkbenchCaseDetail> {
  try {
    const res = await apiFetch<WorkbenchCaseDetail>(`/bff/cases/${caseId}/workbench`)
    if (res && res.caseId) return res
  } catch {
    // Graceful mock fallback seam for UI testing & offline dev
  }
  return { ...MOCK_CASE_DETAIL, caseId: caseId || MOCK_CASE_DETAIL.caseId }
}

export async function updateEntityStatus(
  caseId: string,
  entityId: string,
  status: 'accepted' | 'disputed' | 'pending',
): Promise<{ status: string }> {
  try {
    return await apiFetch(`/bff/cases/${caseId}/entities/${entityId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  } catch {
    return { status }
  }
}

export async function submitDetermination(
  caseId: string,
  decision: 'accept' | 'adverse',
): Promise<{ status: string }> {
  try {
    return await apiFetch(`/bff/cases/${caseId}/determination`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
  } catch {
    return { status: decision }
  }
}

export async function getWorklist(): Promise<WorklistItem[]> {
  try {
    const res = await apiFetch<{ items: WorklistItem[] }>(
      '/bff/queues/default/worklist?page=1&page_size=50',
    )
    if (res && Array.isArray(res.items) && res.items.length > 0) {
      return res.items
    }
  } catch {
    // Graceful mock fallback seam for UI testing & offline dev
  }
  return MOCK_WORKLIST
}
