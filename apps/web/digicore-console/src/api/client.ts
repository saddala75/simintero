export interface PolicyArtifact {
  id: string
  name: string
  version: string
  type: 'coverage_rule' | 'cql_library' | 'value_set'
  lob: 'commercial' | 'medicare' | 'medicaid' | 'all'
  status: 'active' | 'draft' | 'archived'
  effective_date: string
  updated_at: string
  cql?: string
  history?: Array<{
    version: string
    title: string
    timestamp: string
    actor: string
    description: string
    cql?: string
  }>
}

const MOCK_ARTIFACTS: PolicyArtifact[] = [
  {
    id: 'POL-001',
    name: 'Lumbar Spine MRI Prior Auth Rule',
    version: 'v2.4.0',
    type: 'coverage_rule',
    lob: 'medicare',
    status: 'active',
    effective_date: '2026-01-01',
    updated_at: '2026-06-15',
    cql: `library LumbarSpineMRI_PA version '2.4.0'

using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'

parameter "ServiceRequest" ServiceRequest
parameter "Patient" Patient

context Patient

define "Has Conservative Therapy 6 Weeks":
  exists (
    [Procedure: "Physical Therapy"] P
      where P.status = 'completed'
        and durationInDays(P.performed) >= 42
  )

define "Is Determination Approved":
  "Has Conservative Therapy 6 Weeks" and not exists ([Condition: "Red Flag Symptoms"])`,
    history: [
      {
        version: 'v2.4.0',
        title: 'v2.4.0 Published & Active',
        timestamp: '2026-06-15 14:30',
        actor: 'Dr. Sarah Jenkins (CMO)',
        description: 'Updated InterQual 2025 conservative therapy duration criteria from 4 to 6 weeks.',
        cql: `library LumbarSpineMRI_PA version '2.4.0'\n\ndefine "Has Conservative Therapy 6 Weeks":\n  durationInDays(P.performed) >= 42`,
      },
      {
        version: 'v2.3.0',
        title: 'v2.3.0 Superseded',
        timestamp: '2026-01-01 09:00',
        actor: 'Dr. Michael Chen (Medical Director)',
        description: 'Initial 2026 CMS regulatory compliance alignment revision.',
        cql: `library LumbarSpineMRI_PA version '2.3.0'\n\ndefine "Has Conservative Therapy 4 Weeks":\n  durationInDays(P.performed) >= 28`,
      },
    ],
  },
  {
    id: 'POL-002',
    name: 'Physical Therapy Initial Evaluation Library',
    version: 'v1.1.2',
    type: 'cql_library',
    lob: 'commercial',
    status: 'active',
    effective_date: '2025-10-01',
    updated_at: '2026-05-20',
    cql: `library PhysicalTherapyEval version '1.1.2'

using FHIR version '4.0.1'

context Patient

define "Requires PT Plan Of Care":
  exists ([Condition: "Musculoskeletal Disorder"])
`,
    history: [
      {
        version: 'v1.1.2',
        title: 'v1.1.2 Published & Active',
        timestamp: '2026-05-20 10:00',
        actor: 'Dr. Michael Chen',
        description: 'Updated MSK diagnostic codes alignment.',
        cql: `library PhysicalTherapyEval version '1.1.2'\n\ndefine "Requires PT Plan Of Care":\n  exists ([Condition: "Musculoskeletal Disorder"])`,
      },
    ],
  },
  {
    id: 'POL-003',
    name: 'Advanced Diagnostic Imaging ValueSet',
    version: 'v3.0.0-draft',
    type: 'value_set',
    lob: 'all',
    status: 'draft',
    effective_date: '2026-07-01',
    updated_at: '2026-06-28',
    cql: `valueset "Advanced Diagnostic Imaging": 'urn:oid:2.16.840.1.113883.3.464.1003.101.12.1001'`,
    history: [
      {
        version: 'v3.0.0-draft',
        title: 'v3.0.0 Draft Revision',
        timestamp: '2026-06-28 11:00',
        actor: 'Sarah Jenkins',
        description: 'Draft value set expansion.',
        cql: `valueset "Advanced Diagnostic Imaging": 'urn:oid:2.16.840.1.113883.3.464.1003.101.12.1001'`,
      },
    ],
  },
  {
    id: 'POL-004',
    name: 'Bariatric Surgery Qualification CQL',
    version: 'v1.0.0',
    type: 'cql_library',
    lob: 'medicaid',
    status: 'active',
    effective_date: '2026-03-15',
    updated_at: '2026-04-10',
    cql: `library BariatricSurgeryQualification version '1.0.0'

context Patient

define "BMI Greater Than 40":
  Patient.bmi >= 40.0
`,
    history: [
      {
        version: 'v1.0.0',
        title: 'v1.0.0 Published',
        timestamp: '2026-03-15 08:00',
        actor: 'Dr. Sarah Jenkins',
        description: 'Initial release for Medicaid bariatric coverage.',
        cql: `library BariatricSurgeryQualification version '1.0.0'\n\ndefine "BMI Greater Than 40":\n  Patient.bmi >= 40.0`,
      },
    ],
  },
]

export async function getArtifacts(
  type?: string,
  status?: string,
  lob?: string,
  effectiveDate?: string
): Promise<PolicyArtifact[]> {
  try {
    const params = new URLSearchParams()
    if (type && type !== 'all') params.set('type', type)
    if (status && status !== 'all') params.set('status', status)
    if (lob && lob !== 'all') params.set('lob', lob)
    if (effectiveDate && effectiveDate !== 'all') params.set('effective_date', effectiveDate)

    const url = `/vkas/artifacts${params.toString() ? `?${params.toString()}` : ''}`
    const res = await fetch(url)
    if (res.ok) return await res.json()
  } catch {
    // Fallback to mock seam
  }

  return MOCK_ARTIFACTS.filter((item) => {
    if (type && type !== 'all' && item.type !== type) return false
    if (status && status !== 'all' && item.status !== status) return false
    if (lob && lob !== 'all' && item.lob !== lob) return false
    if (effectiveDate && effectiveDate !== 'all' && !item.effective_date.startsWith(effectiveDate)) return false
    return true
  })
}

export async function getArtifactById(id: string): Promise<PolicyArtifact | null> {
  try {
    const res = await fetch(`/vkas/artifacts/${id}`)
    if (res.ok) return await res.json()
  } catch {
    // Fallback to mock seam
  }
  return MOCK_ARTIFACTS.find((item) => item.id === id) ?? null
}

export async function rollbackArtifact(id: string, targetVersion: string): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/vkas/artifacts/${id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_version: targetVersion }),
    })
    if (res.ok) return await res.json()
  } catch {
    // Fallback mock seam
  }
  return { success: true }
}

export async function createArtifact(payload: Partial<PolicyArtifact>): Promise<{ id: string }> {
  try {
    const res = await fetch('/vkas/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) return await res.json()
  } catch {
    // Fallback mock seam
  }
  return { id: `POL-00${Math.floor(Math.random() * 900 + 100)}` }
}
