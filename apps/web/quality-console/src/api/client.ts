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


export async function getMeasures(): Promise<QualityMeasure[]> {
  const res = await fetch('/qualitron/measures/performance')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function getCareGaps(program?: string, status?: string): Promise<CareGap[]> {
  const params = new URLSearchParams()
  if (program && program !== 'all') params.set('program', program)
  if (status && status !== 'all') params.set('status', status)
  const res = await fetch(`/qualitron/gaps/summary?${params.toString()}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function getGapMembers(gapId: string): Promise<CareGapMember[]> {
  const res = await fetch(`/qualitron/gaps/summary/${gapId}/members`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function closeGapMember(gapId: string, memberId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/qualitron/gaps/summary/${gapId}/members/${memberId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function getSubmissionReadiness(): Promise<SubmissionReadinessItem[]> {
  const res = await fetch('/qualitron/readiness')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function lockSubmissionPackage(): Promise<{
  lockId: string
  packageId: string
  lockedAt: string
}> {
  const res = await fetch('/qualitron/submission-lock', { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
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
