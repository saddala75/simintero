import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCareGaps, type CareGap } from '../api/client'
import { DataTable, Badge, Button, Card, type Column } from '@sim/design-system'

export function GapAnalysisPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  const initialProgram = searchParams.get('program') || 'all'
  const initialMeasure = searchParams.get('measure') || ''

  const [selectedProgram, setSelectedProgram] = useState<string>(initialProgram)
  const [selectedStatus, setSelectedStatus] = useState<string>('all')

  const { data: gaps = [], isLoading } = useQuery({
    queryKey: ['care-gaps', selectedProgram, selectedStatus],
    queryFn: () => getCareGaps(selectedProgram, selectedStatus),
  })

  const filtered = useMemo(() => {
    if (!initialMeasure) return gaps
    return gaps.filter((g) => g.measureCode === initialMeasure)
  }, [gaps, initialMeasure])

  const columns: Column<CareGap>[] = [
    {
      key: 'measureCode',
      header: 'Measure',
      render: (row) => <span className="font-mono text-xs font-bold text-slate-900">{row.measureCode}</span>,
    },
    {
      key: 'measureName',
      header: 'Gap Title & Provider',
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.measureName}</div>
          <div className="text-xs text-slate-500">{row.provider}</div>
        </div>
      ),
    },
    {
      key: 'population',
      header: 'Population',
      render: (row) => <span className="font-mono text-xs text-slate-700">{row.population}</span>,
    },
    {
      key: 'memberCount',
      header: 'Open Members',
      render: (row) => <span className="font-mono text-xs font-bold text-slate-900">{row.memberCount.toLocaleString()}</span>,
    },
    {
      key: 'opportunityScore',
      header: 'Opportunity Score',
      render: (row) => (
        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
          {row.opportunityScore} / 100
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const mapped = row.status === 'closed' ? 'approved' : row.status === 'in_progress' ? 'in_review' : 'pending'
        return <Badge variant="status" status={mapped} label={row.status.replace(/_/g, ' ').toUpperCase()} />
      },
    },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              ← Back to Measures
            </Button>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Care Gap Analysis</h1>
              {initialMeasure && (
                <p className="text-xs text-blue-700 font-mono font-bold mt-0.5">
                  Pre-filtered for measure: {initialMeasure}
                </p>
              )}
            </div>
          </div>
        </div>

        <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
            <label className="flex items-center gap-2">
              Quality Program:
              <select
                value={selectedProgram}
                onChange={(e) => setSelectedProgram(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md bg-white font-semibold"
              >
                <option value="all">All Programs</option>
                <option value="HEDIS">HEDIS</option>
                <option value="Stars">CMS Stars</option>
                <option value="QRS">Exchange QRS</option>
                <option value="Medicaid">Medicaid</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Closure Status:
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md bg-white font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="closed">Closed</option>
              </select>
            </label>
          </div>
          <span className="text-xs font-mono text-slate-500 font-bold">{filtered.length} Open Care Gap Identifiers</span>
        </Card>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading care gaps…</div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            keyExtractor={(row) => row.id}
            onRowClick={(row) => navigate(`/gaps/${row.id}`)}
          />
        )}
      </div>
    </div>
  )
}
