import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getArtifacts, type PolicyArtifact } from '../api/client'
import { Card, Badge, Button } from '@sim/design-system'

const TYPE_LABELS: Record<string, string> = {
  coverage_rule: 'Coverage Rule',
  cql_library: 'CQL Library',
  value_set: 'ValueSet',
}

const LOB_COLORS: Record<string, string> = {
  commercial: 'bg-blue-50 text-blue-700 border-blue-200',
  medicare: 'bg-amber-50 text-amber-700 border-amber-200',
  medicaid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  all: 'bg-slate-100 text-slate-700 border-slate-200',
}

export function PolicyListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedLob, setSelectedLob] = useState('all')

  const { data: artifacts = [], isLoading } = useQuery({
    queryKey: ['artifacts', selectedType, selectedStatus, selectedLob],
    queryFn: () => getArtifacts(selectedType, selectedStatus, selectedLob, 'all'),
  })

  const filtered = useMemo(() =>
    artifacts.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.id.toLowerCase().includes(search.toLowerCase())
    ),
    [artifacts, search]
  )

  const activeCount = artifacts.filter((a) => a.status === 'active').length
  const draftCount = artifacts.filter((a) => a.status === 'draft').length

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Policy Intelligence Engine</h1>
            <p className="text-sm text-slate-500 mt-1">
              Coverage rules, CQL libraries &amp; value sets · {activeCount} active, {draftCount} in draft
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/reports')}>
              Governance Reports
            </Button>
            <Button variant="primary" onClick={() => navigate('/digicore/new')}>
              + Author New Policy
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Active Policies', value: '1,482', sub: '+12 this month', subColor: 'text-emerald-600' },
            { label: 'ELM Compliance', value: '99.8%', sub: 'Validated', subColor: 'text-emerald-600' },
            { label: 'Pending Sandbox', value: '24', sub: 'Awaiting simulation', subColor: 'text-amber-600' },
            { label: 'Impact Simulations', value: '8,102', sub: 'DIG-SIM repository', subColor: 'text-slate-500' },
          ].map((s) => (
            <Card key={s.label} className="p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{s.label}</div>
              <div className="text-3xl font-black text-slate-900 tabular-nums">{s.value}</div>
              <div className={`text-xs mt-1.5 font-medium ${s.subColor}`}>{s.sub}</div>
            </Card>
          ))}
        </div>

        {/* Filter bar + table */}
        <Card className="overflow-hidden">
          {/* Filter bar */}
          <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
            <input
              type="search"
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-xs font-semibold text-slate-700"
            >
              <option value="all">All Types</option>
              <option value="coverage_rule">Coverage Rule</option>
              <option value="cql_library">CQL Library</option>
              <option value="value_set">ValueSet</option>
            </select>
            <select
              value={selectedLob}
              onChange={(e) => setSelectedLob(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-xs font-semibold text-slate-700"
            >
              <option value="all">All LOBs</option>
              <option value="commercial">Commercial</option>
              <option value="medicare">Medicare</option>
              <option value="medicaid">Medicaid</option>
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-xs font-semibold text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
            <span className="ml-auto text-xs text-slate-400 font-mono">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="p-12 text-center text-slate-500">Loading policy registry…</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="px-6 py-3">Policy</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">LOB</th>
                  <th className="px-6 py-3">Version</th>
                  <th className="px-6 py-3">Effective</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((item: PolicyArtifact) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/digicore/policies/${item.id}`)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900 text-sm">{item.name}</div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">{item.id}</div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600 font-medium">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant="status"
                        status={item.status === 'active' ? 'approved' : item.status === 'draft' ? 'pending' : 'denied'}
                        label={item.status.toUpperCase()}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded border ${LOB_COLORS[item.lob] ?? LOB_COLORS.all}`}>
                        {item.lob}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">{item.version}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{item.effective_date}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-slate-300 group-hover:text-slate-600 transition-colors text-lg">›</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

      </div>
    </div>
  )
}
