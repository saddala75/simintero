export interface ModelBinding {
  id: string
  name: string
  version: string
  status: 'active' | 'canary' | 'candidate'
  evalScore: number
  citationResolveRate: number
  abstentionRate: number
  trafficPct: number
}

export interface EvalTestCase {
  id: string
  caseName: string
  citationResolved: boolean
  confidenceScore: number
  abstentionStatus: 'passed' | 'abstained'
}

export interface DriftTrend {
  week: string
  avgConfidence: number
  abstentionRate: number
  topExtractedEntity: string
}

const MOCK_MODELS: ModelBinding[] = [
  { id: 'mb-001', name: 'Revital Med-LLM Clinical Extraction', version: 'v3.2.0-prod', status: 'active', evalScore: 96.4, citationResolveRate: 98.2, abstentionRate: 3.1, trafficPct: 90 },
  { id: 'mb-002', name: 'Revital Med-LLM Candidate Canary', version: 'v3.3.0-rc1', status: 'canary', evalScore: 98.1, citationResolveRate: 99.4, abstentionRate: 2.4, trafficPct: 10 },
  { id: 'mb-003', name: 'Experimental Fine-Tune Bariatric', version: 'v4.0.0-exp', status: 'candidate', evalScore: 92.0, citationResolveRate: 94.0, abstentionRate: 6.5, trafficPct: 0 },
]

const MOCK_EVALS: EvalTestCase[] = [
  { id: 'eval-101', caseName: 'Lumbar Spine MRI Refractory Conservative PT', citationResolved: true, confidenceScore: 0.98, abstentionStatus: 'passed' },
  { id: 'eval-102', caseName: 'Knee Arthroplasty Incomplete Clinical Note', citationResolved: false, confidenceScore: 0.42, abstentionStatus: 'abstained' },
  { id: 'eval-103', caseName: 'Bariatric Surgery Comorbid Diabetes Assessment', citationResolved: true, confidenceScore: 0.94, abstentionStatus: 'passed' },
]

const MOCK_DRIFT: DriftTrend[] = [
  { week: 'Week 26 (Current)', avgConfidence: 0.95, abstentionRate: 3.1, topExtractedEntity: 'Lumbar Radiculopathy' },
  { week: 'Week 25', avgConfidence: 0.94, abstentionRate: 3.4, topExtractedEntity: 'Osteoarthritis' },
  { week: 'Week 24', avgConfidence: 0.96, abstentionRate: 2.9, topExtractedEntity: 'Diabetes Mellitus' },
]

export async function getModelBindings(): Promise<ModelBinding[]> {
  try {
    const res = await fetch('/ai-ops/models')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_MODELS
}

export async function promoteCanary(modelId: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/ai-ops/models/${modelId}/canary`, { method: 'POST' })
    if (res.ok) return await res.json()
  } catch {}
  return { success: true }
}

export async function runEvalSuite(modelId: string): Promise<EvalTestCase[]> {
  try {
    const res = await fetch(`/ai-ops/models/${modelId}/eval`)
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_EVALS
}

export async function getDriftTrends(): Promise<DriftTrend[]> {
  try {
    const res = await fetch('/ai-ops/drift')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_DRIFT
}
