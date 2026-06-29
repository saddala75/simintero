import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAssignedAppeals, getOpenAppeals } from '../api/client'
import { AppShell } from '../components/AppShell'
import { AppealFilingModal } from '../components/AppealFilingModal'
import { useAuth, hasRole } from '../auth/AuthContext'
import type { AppealItem } from '../types'
import { DataTable, Badge, Button, Card, type Column } from '@sim/design-system'

export function AppealsPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'assigned'
  const [filingOpen, setFilingOpen] = useState(false)

  const { data: assigned = [], isLoading: loadingAssigned, refetch: refetchAssigned } = useQuery({
    queryKey: ['appeals', 'assigned'],
    queryFn: getAssignedAppeals,
  })
  const { data: open = [], isLoading: loadingOpen, refetch: refetchOpen } = useQuery({
    queryKey: ['appeals', 'open'],
    queryFn: getOpenAppeals,
  })

  if (!hasRole(auth, 'appeals_coordinator')) {
    return (
      <AppShell breadcrumb={<b>Appeals</b>}>
        <div className="max-w-[1320px] mx-auto px-6 py-12">
          <Card className="p-8 text-center text-slate-500">
            You do not have the appeals_coordinator role.
          </Card>
        </div>
      </AppShell>
    )
  }

  const isLoading = activeTab === 'assigned' ? loadingAssigned : loadingOpen
  const items = activeTab === 'assigned' ? assigned : open

  const columns: Column<AppealItem>[] = [
    {
      key: 'member_name',
      header: 'Member',
      render: (row: AppealItem) => <span className="font-semibold text-slate-900">{row.member_name}</span>,
    },
    {
      key: 'case_id',
      header: 'Case ID',
      render: (row: AppealItem) => (
        <span className="font-mono text-xs font-bold text-slate-700">
          {row.case_id.slice(0, 8).toUpperCase()}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row: AppealItem) => <Badge variant="rule" label={row.category.replace(/_/g, ' ').toUpperCase()} />,
    },
    {
      key: 'requested_outcome',
      header: 'Requested Outcome',
      render: (row: AppealItem) => (
        <span className="capitalize text-slate-700 font-medium">
          {row.requested_outcome.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: AppealItem) => {
        const mapped: 'approved' | 'pending' | 'in_review' = row.status === 'filed' ? 'pending' : row.status === 'decided' ? 'approved' : 'in_review'
        return <Badge variant="status" status={mapped} label={row.status.replace(/_/g, ' ')} />
      },
    },
    {
      key: 'days_open',
      header: 'Days Open',
      render: (row: AppealItem) => <span className="font-mono text-xs font-bold text-slate-600">{row.days_open}d</span>,
    },
    {
      key: 'action',
      header: '',
      render: () => <span className="text-slate-400 font-bold">→</span>,
    },
  ]

  return (
    <AppShell breadcrumb={<b>Appeals</b>}>
      <div className="max-w-[1320px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Appeals & Grievances</h1>
            <p className="text-sm text-slate-500 mt-1">Appeal review · coordinator worklist</p>
          </div>
          <Button variant="primary" onClick={() => setFilingOpen(true)} data-testid="btn-file-appeal-worklist">
            File Appeal
          </Button>
        </div>

        <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-lg w-fit mb-6">
          <button
            onClick={() => setSearchParams({ tab: 'assigned' })}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === 'assigned' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Assigned to Me ({assigned.length})
          </button>
          <button
            onClick={() => setSearchParams({ tab: 'open' })}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === 'open' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Open ({open.length})
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading appeals…</div>
        ) : (
          <DataTable
            columns={columns}
            data={items}
            keyExtractor={(row: AppealItem) => row.appeal_id}
            onRowClick={(row: AppealItem) => navigate(`/cases/${row.case_id}/appeals/${row.appeal_id}`)}
          />
        )}

        {filingOpen && (
          <AppealFilingModal
            onClose={() => setFilingOpen(false)}
            onFiled={(cid, aid) => {
              setFilingOpen(false)
              refetchAssigned()
              refetchOpen()
              if (cid && aid) {
                navigate(`/cases/${cid}/appeals/${aid}`)
              }
            }}
          />
        )}
      </div>
    </AppShell>
  )
}
