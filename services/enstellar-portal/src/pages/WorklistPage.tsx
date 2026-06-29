import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getWorklist, getQueueStats } from '../api/client'
import { AppShell } from '../components/AppShell'
import type { WorklistItem, QueueStats } from '../types'
import { DataTable, Badge, SlaIndicator, Card, Button, type Column } from '@sim/design-system'

const DECIDED = new Set(['approved', 'denied', 'partially_denied', 'adverse_modification'])

function tabFilter(item: WorklistItem, tab: string): boolean {
  if (tab === 'all') return true
  if (tab === 'review') return item.status === 'clinical_review'
  if (tab === 'info') return item.status === 'pend_rfi' || item.status === 'completeness_check'
  if (tab === 'md') return item.status === 'md_review'
  if (tab === 'decided') return DECIDED.has(item.status)
  return true
}

function isExpedited(urgency: string) {
  return urgency === 'expedited' || urgency === 'urgent' || urgency === 'concurrent'
}

function lobToChannel(lob: string): string {
  if (lob.includes('medicare') || lob.includes('medicaid')) return 'X12'
  return 'FHIR'
}

function shortId(caseId: string): string {
  return `PA-${caseId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export function WorklistPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('all')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['worklist', 'default', 1],
    queryFn: () => getWorklist('default', 1),
    refetchInterval: 30_000,
  })

  const { data: queueStats } = useQuery<QueueStats>({
    queryKey: ['stats', 'default'],
    queryFn: () => getQueueStats('default'),
    staleTime: 60_000,
  })

  const items = data?.items ?? []

  const counts = useMemo(() => {
    const inReview = items.filter(i => i.status === 'clinical_review').length
    const awaitingInfo = items.filter(i => i.status === 'pend_rfi' || i.status === 'completeness_check').length
    const pendingMd = items.filter(i => i.status === 'md_review').length
    const decided = items.filter(i => DECIDED.has(i.status)).length
    const breaching = items.filter(i => i.sla?.rag === 'red' && !i.sla?.paused).length
    const dueToday = items.filter(i => i.sla && !i.sla.paused && i.sla.hours_remaining <= 24).length
    return { total: items.length, inReview, awaitingInfo, pendingMd, decided, breaching, dueToday }
  }, [items])

  const filtered = useMemo(() => items.filter(i => tabFilter(i, activeTab)), [items, activeTab])
  const mdPending = useMemo(() => items.filter(i => i.status === 'md_review'), [items])

  const columns: Column<WorklistItem>[] = [
    {
      key: 'case_id',
      header: 'Case',
      render: (row: WorklistItem) => (
        <div className="flex items-center gap-2 font-mono text-xs font-semibold">
          <span className={`w-2 h-2 rounded-full ${isExpedited(row.urgency) ? 'bg-red-600' : 'bg-slate-300'}`} />
          {shortId(row.case_id)}
        </div>
      ),
    },
    {
      key: 'member_name',
      header: 'Member',
      render: (row: WorklistItem) => (
        <div>
          <div className="font-semibold text-slate-900">{row.member_name}</div>
          <div className="text-xs text-slate-500">{row.lob.replace(/_/g, ' ')}</div>
        </div>
      ),
    },
    {
      key: 'service_description',
      header: 'Service',
      render: (row: WorklistItem) => <span className="font-medium text-slate-800">{row.service_description}</span>,
    },
    {
      key: 'channel',
      header: 'Channel',
      render: (row: WorklistItem) => (
        <span className="font-mono text-xs px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600">
          {lobToChannel(row.lob)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: WorklistItem) => {
        const BADGE_STATUS_MAP: Record<string, 'approved' | 'denied' | 'pending' | 'in_review' | 'breached' | 'filed' | 'pended'> = {
          approved: 'approved',
          denied: 'denied',
          partially_denied: 'denied',
          adverse_modification: 'denied',
          clinical_review: 'in_review',
          md_review: 'pending',
          pend_rfi: 'pended',
          completeness_check: 'pending',
          intake: 'pending',
        }
        const statusKey = BADGE_STATUS_MAP[row.status] ?? 'pending'
        return <Badge variant="status" status={statusKey} label={row.status.replace(/_/g, ' ')} />
      },
    },
    {
      key: 'sla',
      header: 'SLA Clock',
      render: (row: WorklistItem) => (
        <SlaIndicator
          hoursRemaining={row.sla?.hours_remaining ?? 48}
          totalHours={72}
          breached={row.sla?.rag === 'red'}
        />
      ),
    },
    {
      key: 'action',
      header: '',
      render: () => <span className="text-slate-400 font-bold">→</span>,
    },
  ]

  return (
    <AppShell breadcrumb={<b>Utilization Management</b>}>
      <div className="max-w-[1320px] mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Utilization Management</h1>
            <p className="text-sm text-slate-500 mt-1">Prior authorization · live review queue</p>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="p-4">
            <div className="text-2xl font-black text-slate-900">{isLoading ? '…' : counts.total}</div>
            <div className="text-xs text-slate-500 mt-1">In Queue</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-black text-amber-600">{isLoading ? '…' : counts.dueToday}</div>
            <div className="text-xs text-slate-500 mt-1">Due Today (&lt;24h)</div>
          </Card>
          <Card className="p-4 border-red-200 bg-red-50/30">
            <div className="text-2xl font-black text-red-600">{isLoading ? '…' : counts.breaching}</div>
            <div className="text-xs text-slate-500 mt-1">Breaching &lt;4h</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-black text-slate-900">{isLoading ? '…' : counts.awaitingInfo}</div>
            <div className="text-xs text-slate-500 mt-1">Awaiting Info</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-black text-emerald-700">{isLoading ? '…' : counts.decided}</div>
            <div className="text-xs text-slate-500 mt-1">Decided</div>
          </Card>
        </div>

        {/* Main Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-4">
            {/* Filter Tabs */}
            <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-lg w-fit">
              {[
                { id: 'all', label: 'All', count: counts.total },
                { id: 'review', label: 'In Review', count: counts.inReview },
                { id: 'info', label: 'Awaiting Info', count: counts.awaitingInfo },
                { id: 'md', label: 'Pending MD', count: counts.pendingMd },
                { id: 'decided', label: 'Decided', count: counts.decided },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label} <span className="ml-1 text-[10px] font-mono opacity-60">({tab.count})</span>
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading worklist cases…</div>
            ) : isError ? (
              <div className="p-8 text-center text-red-600 text-sm">{(error as Error).message}</div>
            ) : (
              <DataTable
                columns={columns}
                data={filtered}
                keyExtractor={(row: WorklistItem) => row.case_id}
                onRowClick={(row: WorklistItem) => navigate(`/cases/${row.case_id}`)}
              />
            )}
          </div>

          <div className="space-y-4">
            {mdPending.length > 0 && (
              <Card className="p-4 border-amber-200">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-3">
                  Pending MD Determination ({mdPending.length})
                </h3>
                <div className="space-y-2">
                  {mdPending.map((item) => (
                    <Button
                      key={item.case_id}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between text-left h-auto p-2.5"
                      onClick={() => navigate(`/cases/${item.case_id}`)}
                    >
                      <div>
                        <div className="font-mono text-xs font-bold text-slate-900">{shortId(item.case_id)}</div>
                        <div className="text-xs text-slate-600 truncate max-w-[160px]">{item.service_description}</div>
                      </div>
                      <span className="text-xs font-mono text-amber-700 font-semibold">{item.sla?.hours_remaining ?? 0}h</span>
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-4 bg-slate-900 text-white">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Governed AI Guardrails
              </h3>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span>AI determinations</span>
                  <span className="font-mono font-bold text-emerald-400">{queueStats?.ai_determinations ?? 0}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span>Human-signed adverse %</span>
                  <span className="font-mono font-bold text-blue-400">{(queueStats?.adverse_human_signed_pct ?? 100).toFixed(1)}%</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
