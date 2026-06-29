import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getArtifacts, type PolicyArtifact } from '../api/client'
import { DataTable, Badge, Button, Card, type Column } from '@sim/design-system'

export function PolicyListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [selectedLob, setSelectedLob] = useState<string>('all')
  const [selectedEffectiveDate, setSelectedEffectiveDate] = useState<string>('all')

  const { data: artifacts = [], isLoading } = useQuery({
    queryKey: ['artifacts', selectedType, selectedStatus, selectedLob, selectedEffectiveDate],
    queryFn: () => getArtifacts(selectedType, selectedStatus, selectedLob, selectedEffectiveDate),
  })

  const filtered = useMemo(() => {
    return artifacts.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase())
      return matchesSearch
    })
  }, [artifacts, search])

  const columns: Column<PolicyArtifact>[] = [
    {
      key: 'id',
      header: 'Artifact ID',
      render: (row) => <span className="font-mono text-xs font-bold text-slate-900">{row.id}</span>,
    },
    {
      key: 'name',
      header: 'Policy Name',
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.name}</div>
          <div className="text-xs text-slate-500 font-mono">{row.version}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Artifact Type',
      render: (row) => <Badge variant="rule" label={row.type.replace(/_/g, ' ').toUpperCase()} />,
    },
    {
      key: 'lob',
      header: 'LOB Applicability',
      render: (row) => (
        <span className="font-mono text-xs uppercase px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-semibold">
          {row.lob}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const mapped = row.status === 'active' ? 'approved' : row.status === 'draft' ? 'pending' : 'denied'
        return <Badge variant="status" status={mapped} label={row.status.toUpperCase()} />
      },
    },
    {
      key: 'effective_date',
      header: 'Effective Date',
      render: (row) => <span className="font-mono text-xs text-slate-600">{row.effective_date}</span>,
    },
  ]

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Digicore Policy Studio</h1>
            <p className="text-sm text-slate-500 mt-1">VKAS Clinical Decision Support Rule Registry & Governance</p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/reports')}>
              Governance Reports
            </Button>
            <Button variant="primary" onClick={() => navigate('/new')}>
              + Author New Policy
            </Button>
          </div>
        </div>

        <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
          <input
            type="text"
            placeholder="Search artifacts by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 border border-slate-300 rounded-md text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
            <label className="flex items-center gap-2">
              Type:
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Types</option>
                <option value="coverage_rule">Coverage Rule</option>
                <option value="cql_library">CQL Library</option>
                <option value="value_set">ValueSet</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              LOB:
              <select
                value={selectedLob}
                onChange={(e) => setSelectedLob(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All LOBs</option>
                <option value="commercial">Commercial</option>
                <option value="medicare">Medicare</option>
                <option value="medicaid">Medicaid</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Effective Year:
              <select
                value={selectedEffectiveDate}
                onChange={(e) => setSelectedEffectiveDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Effective Years</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Status:
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>
        </Card>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading policy registry artifacts…</div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            keyExtractor={(row) => row.id}
            onRowClick={(row) => navigate(`/policies/${row.id}`)}
          />
        )}
      </div>
    </div>
  )
}
