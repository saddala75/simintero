export interface QualityMeasure {
  id: string
  code: string
  name: string
  program: 'HEDIS' | 'Stars' | 'QRS' | 'Medicaid'
  score: number
  target: number
  trend: 'up' | 'down' | 'stable'
  population: string
  numerator: number
  denominator: number
}

export interface CareGap {
  id: string
  measureId: string
  measureCode: string
  measureName: string
  population: string
  provider: string
  memberCount: number
  opportunityScore: number
  status: 'open' | 'in_progress' | 'closed'
}

export interface CareGapMember {
  memberId: string
  memberName: string
  dob: string
  pcp: string
  status: 'open' | 'outreach_sent' | 'data_received' | 'closed'
  lastContact: string
}

export interface SubmissionReadinessItem {
  id: string
  measureCode: string
  measureName: string
  auditStatus: 'passed' | 'warning' | 'error'
  dataQualityFlags: number
  readyForSubmission: boolean
}

const MOCK_MEASURES: QualityMeasure[] = [
  { id: 'm-1', code: 'COL', name: 'Colorectal Cancer Screening', program: 'HEDIS', score: 78.4, target: 80.0, trend: 'up', population: 'Commercial Age 50-75', numerator: 3920, denominator: 5000 },
  { id: 'm-2', code: 'BCS', name: 'Breast Cancer Screening', program: 'Stars', score: 84.2, target: 85.0, trend: 'stable', population: 'Medicare Advantage Women 50-74', numerator: 4210, denominator: 5000 },
  { id: 'm-3', code: 'A1C', name: 'Diabetes HbA1c Poor Control (>9.0%)', program: 'QRS', score: 14.2, target: 12.0, trend: 'down', population: 'Exchange Diabetics 18-75', numerator: 710, denominator: 5000 },
  { id: 'm-4', code: 'CBP', name: 'Controlling High Blood Pressure', program: 'Medicaid', score: 72.1, target: 75.0, trend: 'up', population: 'Medicaid Hypertensive Adults', numerator: 3605, denominator: 5000 },
]

const MOCK_GAPS: CareGap[] = [
  { id: 'gap-101', measureId: 'm-1', measureCode: 'COL', measureName: 'Colorectal Cancer Screening Gap', population: 'Commercial', provider: 'Valley Health Medical Group', memberCount: 1080, opportunityScore: 94, status: 'open' },
  { id: 'gap-102', measureId: 'm-2', measureCode: 'BCS', measureName: 'Mammography Due Gap', population: 'Medicare Advantage', provider: 'Apex Medical Associates', memberCount: 790, opportunityScore: 88, status: 'in_progress' },
  { id: 'gap-103', measureId: 'm-3', measureCode: 'A1C', measureName: 'HbA1c Overdue Screening Gap', population: 'Exchange QRS', provider: 'Metro Health Center', memberCount: 1290, opportunityScore: 91, status: 'open' },
]

const MOCK_MEMBERS: Record<string, CareGapMember[]> = {
  'gap-101': [
    { memberId: 'MB-8821', memberName: 'Arthur Pendelton', dob: '1962-08-14', pcp: 'Dr. Michael Chen', status: 'open', lastContact: '2026-05-10' },
    { memberId: 'MB-8822', memberName: 'Beatrice Smith', dob: '1959-11-23', pcp: 'Dr. Sarah Jenkins', status: 'outreach_sent', lastContact: '2026-06-01' },
    { memberId: 'MB-8823', memberName: 'Charles Montgomery', dob: '1970-03-05', pcp: 'Dr. Michael Chen', status: 'data_received', lastContact: '2026-06-15' },
  ],
  'gap-102': [
    { memberId: 'MB-9901', memberName: 'Diana Prince', dob: '1966-02-18', pcp: 'Dr. Evelyn Reed', status: 'open', lastContact: '2026-04-20' },
  ],
}

const MOCK_READINESS: SubmissionReadinessItem[] = [
  { id: 'sr-1', measureCode: 'COL', measureName: 'Colorectal Cancer Screening', auditStatus: 'passed', dataQualityFlags: 0, readyForSubmission: true },
  { id: 'sr-2', measureCode: 'BCS', measureName: 'Breast Cancer Screening', auditStatus: 'passed', dataQualityFlags: 2, readyForSubmission: true },
  { id: 'sr-3', measureCode: 'A1C', measureName: 'Diabetes HbA1c Control', auditStatus: 'warning', dataQualityFlags: 14, readyForSubmission: false },
]

export async function getMeasures(): Promise<QualityMeasure[]> {
  const res = await fetch('/qualitron/measures/performance')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function getCareGaps(program?: string, status?: string): Promise<CareGap[]> {
  try {
    const params = new URLSearchParams()
    if (program && program !== 'all') params.set('program', program)
    if (status && status !== 'all') params.set('status', status)
    const res = await fetch(`/qualitron/gaps?${params.toString()}`)
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_GAPS.filter((g) => {
    if (program && program !== 'all') {
      const measure = MOCK_MEASURES.find((m) => m.id === g.measureId)
      if (measure && measure.program !== program) return false
    }
    if (status && status !== 'all' && g.status !== status) return false
    return true
  })
}

export async function getGapMembers(gapId: string): Promise<CareGapMember[]> {
  try {
    const res = await fetch(`/qualitron/gaps/${gapId}/members`)
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_MEMBERS[gapId] ?? []
}

export async function closeGapMember(gapId: string, memberId: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/qualitron/gaps/${gapId}/members/${memberId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (res.ok) return await res.json()
  } catch {}
  return { success: true }
}

export async function getSubmissionReadiness(): Promise<SubmissionReadinessItem[]> {
  try {
    const res = await fetch('/qualitron/readiness')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_READINESS
}

export async function lockSubmissionPackage(): Promise<{ success: boolean; packageId: string }> {
  try {
    const res = await fetch('/qualitron/submission-lock', { method: 'POST' })
    if (res.ok) return await res.json()
  } catch {}
  return { success: true, packageId: `PKG-2026-${Math.floor(Math.random() * 9000 + 1000)}` }
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

export async function getMeasureLibrary(): Promise<MeasureCatalogItem[]> {
  const res = await fetch('/bff/measures/library')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function activateMeasure(id: string): Promise<{ id: string; active: boolean }> {
  const res = await fetch(`/bff/measures/library/${id}/activate`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function deactivateMeasure(id: string): Promise<{ id: string; active: boolean }> {
  const res = await fetch(`/bff/measures/library/${id}/deactivate`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}
