export interface Tenant {
  id: string
  name: string
  plan: 'enterprise' | 'growth' | 'pilot'
  status: 'active' | 'suspended' | 'onboarding'
  lobs: string[]
  casesPerMonth: number
  aiAssistRate: number
  keycloakGroup: string
}

export interface PlatformUser {
  id: string
  tenantId: string
  name: string
  email: string
  role: 'medical_director' | 'reviewer' | 'intake_coordinator' | 'investigator'
  status: 'active' | 'inactive'
}

export interface GlobalUsage {
  totalCasesPerMonth: number
  avgAiAssistRate: number
  globalSlaCompliancePct: number
}

const MOCK_TENANTS: Tenant[] = [
  { id: 'ten-001', name: 'Aetna Commercial', plan: 'enterprise', status: 'active', lobs: ['commercial', 'medicare'], casesPerMonth: 45200, aiAssistRate: 88.4, keycloakGroup: '/tenants/aetna' },
  { id: 'ten-002', name: 'Humana Advantage', plan: 'enterprise', status: 'active', lobs: ['medicare'], casesPerMonth: 32100, aiAssistRate: 91.2, keycloakGroup: '/tenants/humana' },
  { id: 'ten-003', name: 'Centene Medicaid Plan', plan: 'growth', status: 'onboarding', lobs: ['medicaid'], casesPerMonth: 12000, aiAssistRate: 74.0, keycloakGroup: '/tenants/centene' },
]

const MOCK_USERS: PlatformUser[] = [
  { id: 'usr-101', tenantId: 'ten-001', name: 'Dr. Sarah Jenkins', email: 'sjenkins@aetna.com', role: 'medical_director', status: 'active' },
  { id: 'usr-102', tenantId: 'ten-001', name: 'Michael Chen', email: 'mchen@aetna.com', role: 'reviewer', status: 'active' },
  { id: 'usr-103', tenantId: 'ten-002', name: 'Evelyn Reed', email: 'ereed@humana.com', role: 'intake_coordinator', status: 'active' },
]

const MOCK_USAGE: GlobalUsage = {
  totalCasesPerMonth: 89300,
  avgAiAssistRate: 86.4,
  globalSlaCompliancePct: 99.98,
}

export async function getTenants(): Promise<Tenant[]> {
  try {
    const res = await fetch('/admin/tenants')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_TENANTS
}

export async function toggleTenantStatus(tenantId: string, status: 'active' | 'suspended'): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`/admin/tenants/${tenantId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) return await res.json()
  } catch {}
  return { success: true }
}

export async function provisionTenant(payload: Partial<Tenant>): Promise<{ id: string }> {
  try {
    const res = await fetch('/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) return await res.json()
  } catch {}
  return { id: `ten-00${Math.floor(Math.random() * 900 + 100)}` }
}

export async function getUsers(tenantId?: string): Promise<PlatformUser[]> {
  try {
    const res = await fetch(`/admin/users${tenantId ? `?tenantId=${tenantId}` : ''}`)
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_USERS
}

export async function inviteUser(payload: Partial<PlatformUser>): Promise<{ id: string }> {
  try {
    const res = await fetch('/admin/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) return await res.json()
  } catch {}
  return { id: `usr-${Math.floor(Math.random() * 900 + 100)}` }
}

export async function getGlobalUsage(): Promise<GlobalUsage> {
  try {
    const res = await fetch('/admin/usage')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_USAGE
}
