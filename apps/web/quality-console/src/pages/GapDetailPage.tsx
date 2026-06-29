import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getGapMembers, closeGapMember, type CareGapMember } from '../api/client'
import { Card, Badge, Button, DataTable, type Column } from '@sim/design-system'

export function GapDetailPage() {
  const { id = 'gap-101' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [closeMessage, setCloseMessage] = useState<string | null>(null)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['gap-members', id],
    queryFn: () => getGapMembers(id),
  })

  const closeMut = useMutation({
    mutationFn: (memberId: string) => closeGapMember(id, memberId),
    onSuccess: (_, memberId) => {
      setCloseMessage(`Care Gap successfully confirmed closed for member ${memberId}! Supplemental data ingested.`)
      queryClient.invalidateQueries({ queryKey: ['gap-members', id] })
    },
  })

  const columns: Column<CareGapMember>[] = [
    {
      key: 'memberId',
      header: 'Member ID',
      render: (row) => <span className="font-mono text-xs font-bold text-slate-900">{row.memberId}</span>,
    },
    {
      key: 'memberName',
      header: 'Member Name',
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.memberName}</div>
          <div className="text-xs text-slate-500">DOB: {row.dob}</div>
        </div>
      ),
    },
    {
      key: 'pcp',
      header: 'PCP Practitioner',
      render: (row) => <span className="text-xs font-medium text-slate-700">{row.pcp}</span>,
    },
    {
      key: 'status',
      header: 'Outreach & Data Status',
      render: (row) => {
        const mapped = row.status === 'closed' ? 'approved' : row.status === 'data_received' ? 'in_review' : 'pending'
        return <Badge variant="status" status={mapped} label={row.status.replace(/_/g, ' ').toUpperCase()} />
      },
    },
    {
      key: 'action',
      header: 'Actions',
      render: (row) => (
        <Button
          variant={row.status === 'closed' ? 'ghost' : 'primary'}
          size="sm"
          disabled={row.status === 'closed' || closeMut.isPending}
          onClick={() => closeMut.mutate(row.memberId)}
        >
          {row.status === 'closed' ? 'Closed' : 'Confirm Gap Closure'}
        </Button>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {closeMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex items-center justify-between">
            <span>✓ {closeMessage}</span>
            <button onClick={() => setCloseMessage(null)} className="font-bold text-xs">✕</button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/gaps')}>
              ← Back to Care Gaps
            </Button>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Care Gap Detail · {id}</h1>
              <p className="text-sm text-slate-500 mt-1">Member-level supplemental data tracking & closure reconciliation</p>
            </div>
          </div>
        </div>

        <Card className="p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">Assigned Member Population</h3>
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Loading assigned gap members…</div>
          ) : (
            <DataTable columns={columns} data={members} keyExtractor={(row) => row.memberId} />
          )}
        </Card>
      </div>
    </div>
  )
}
