import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTenants, toggleTenantStatus, provisionTenant, getUsers, inviteUser, type Tenant, type PlatformUser } from './api/client'
import { Card, Badge, Button, DataTable, type Column } from '@sim/design-system'

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'tenants' | 'usage' | 'users' | 'provision'>('tenants')
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // New Tenant Form State
  const [newOrgName, setNewOrgName] = useState('')
  const [newPlan, setNewPlan] = useState<'enterprise' | 'growth' | 'pilot'>('enterprise')

  // New User Form State
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<'medical_director' | 'reviewer' | 'intake_coordinator' | 'investigator'>('reviewer')

  const { data: tenants = [], isLoading: loadingTenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: getTenants,
  })

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers(),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' }) => toggleTenantStatus(id, status),
    onSuccess: (_, variables) => {
      setActionMsg(`Tenant ${variables.id} status updated to ${variables.status.toUpperCase()}! Keycloak realm updated.`)
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })

  const provisionMut = useMutation({
    mutationFn: () => provisionTenant({ name: newOrgName || 'New Payer Org', plan: newPlan }),
    onSuccess: (res) => {
      setActionMsg(`Payer Organization "${newOrgName || 'New Payer Org'}" successfully provisioned as tenant ${res.id}! Keycloak group created.`)
      setNewOrgName('')
      setActiveTab('tenants')
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })

  const inviteMut = useMutation({
    mutationFn: () => inviteUser({ name: newUserName, email: newUserEmail, role: newUserRole, tenantId: 'ten-001' }),
    onSuccess: () => {
      setActionMsg(`User "${newUserName}" (${newUserEmail}) successfully invited with role ${newUserRole.toUpperCase()}! Keycloak credential email sent.`)
      setNewUserName('')
      setNewUserEmail('')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const tenantColumns: Column<Tenant>[] = [
    { key: 'id', header: 'Tenant ID', render: (row) => <span className="font-mono text-xs font-bold">{row.id}</span> },
    { key: 'name', header: 'Payer Organization', render: (row) => <span className="font-bold text-slate-900">{row.name}</span> },
    { key: 'plan', header: 'Tier Plan', render: (row) => <Badge variant="rule" label={row.plan.toUpperCase()} /> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant="status" status={row.status === 'active' ? 'approved' : 'denied'} label={row.status.toUpperCase()} />,
    },
    { key: 'casesPerMonth', header: 'Monthly Volume', render: (row) => <span className="font-mono text-xs font-bold">{row.casesPerMonth.toLocaleString()} cases/mo</span> },
    {
      key: 'action',
      header: 'Actions',
      render: (row) => (
        <Button
          variant={row.status === 'active' ? 'danger' : 'primary'}
          size="sm"
          loading={statusMut.isPending}
          onClick={() => statusMut.mutate({ id: row.id, status: row.status === 'active' ? 'suspended' : 'active' })}
        >
          {row.status === 'active' ? 'Suspend Tenant' : 'Activate Tenant'}
        </Button>
      ),
    },
  ]

  const userColumns: Column<PlatformUser>[] = [
    { key: 'id', header: 'User ID', render: (r) => <span className="font-mono text-xs font-bold">{r.id}</span> },
    { key: 'name', header: 'User Name & Email', render: (r) => <div><div className="font-bold text-slate-900">{r.name}</div><div className="text-xs text-slate-500 font-mono">{r.email}</div></div> },
    { key: 'tenantId', header: 'Assigned Tenant', render: (r) => <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded">{r.tenantId}</span> },
    { key: 'role', header: 'Keycloak IAM Role', render: (r) => <Badge variant="rule" label={r.role.replace(/_/g, ' ').toUpperCase()} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant="status" status="approved" label={r.status.toUpperCase()} /> },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {actionMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex justify-between items-center">
            <span>✓ {actionMsg}</span>
            <button onClick={() => setActionMsg(null)} className="font-bold text-xs">✕ Dismiss</button>
          </div>
        )}

        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Simintero SaaS Admin Console</h1>
            <p className="text-sm text-slate-500 mt-1">Multi-Tenant Payer Governance, Keycloak IAM & System Provisioning</p>
          </div>
          <Button variant="primary" onClick={() => setActiveTab('provision')}>
            + Provision New Tenant
          </Button>
        </div>

        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit text-xs font-semibold">
          {(['tenants', 'usage', 'users', 'provision'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md capitalize transition-colors ${activeTab === tab ? 'bg-white shadow-sm text-slate-900 font-bold' : 'text-slate-600'}`}
            >
              {tab === 'tenants' ? 'Tenant Management' : tab === 'usage' ? 'Global Usage Metrics' : tab === 'users' ? 'User Management & IAM' : 'Provisioning Wizard'}
            </button>
          ))}
        </div>

        {activeTab === 'tenants' && (
          <Card className="p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Provisioned Payer Organizations</h3>
            {loadingTenants ? <div className="p-8 text-center text-slate-500">Loading tenant directory…</div> : <DataTable columns={tenantColumns} data={tenants} keyExtractor={(r) => r.id} />}
          </Card>
        )}

        {activeTab === 'provision' && (
          <Card className="p-6 max-w-xl space-y-4">
            <h3 className="font-bold text-base text-slate-900">Provision New Payer Organization</h3>
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Organization Name</label>
              <input
                type="text"
                placeholder="e.g. BlueCross BlueShield State Plan"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Subscription Plan Tier</label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value as typeof newPlan)}
                className="w-full px-4 py-2 border border-slate-300 rounded-md text-sm bg-white"
              >
                <option value="enterprise">Enterprise Plan (Unlimited)</option>
                <option value="growth">Growth Plan (Up to 50k cases/mo)</option>
                <option value="pilot">Pilot Trial Plan</option>
              </select>
            </div>
            <Button
              variant="primary"
              loading={provisionMut.isPending}
              onClick={() => provisionMut.mutate()}
            >
              Confirm & Initialize Tenant Infra
            </Button>
          </Card>
        )}

        {activeTab === 'usage' && (
          <div className="grid grid-cols-3 gap-6">
            <Card className="p-6">
              <div className="text-3xl font-black text-slate-900">89,300</div>
              <div className="text-xs text-slate-500 mt-1">Total System Cases / Month</div>
            </Card>
            <Card className="p-6">
              <div className="text-3xl font-black text-blue-600">86.4%</div>
              <div className="text-xs text-slate-500 mt-1">Average AI Assist Rate</div>
            </Card>
            <Card className="p-6">
              <div className="text-3xl font-black text-emerald-600">99.98%</div>
              <div className="text-xs text-slate-500 mt-1">Global SLA Compliance</div>
            </Card>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <Card className="p-6 space-y-4">
              <h3 className="font-bold text-base text-slate-900">Invite New Platform User (Keycloak IAM)</h3>
              <div className="grid grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded text-xs"
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded text-xs"
                />
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as typeof newUserRole)}
                  className="px-3 py-2 border border-slate-300 rounded text-xs bg-white font-semibold"
                >
                  <option value="reviewer">Reviewer</option>
                  <option value="medical_director">Medical Director</option>
                  <option value="intake_coordinator">Intake Coordinator</option>
                  <option value="investigator">Investigator</option>
                </select>
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={inviteMut.isPending}
                onClick={() => inviteMut.mutate()}
              >
                Send Keycloak Invitation
              </Button>
            </Card>

            <Card className="p-6">
              <h3 className="font-bold text-base text-slate-900 mb-4">Active Platform User Roster</h3>
              {loadingUsers ? <div className="p-8 text-center text-slate-500">Loading IAM users…</div> : <DataTable columns={userColumns} data={users} keyExtractor={(r) => r.id} />}
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
