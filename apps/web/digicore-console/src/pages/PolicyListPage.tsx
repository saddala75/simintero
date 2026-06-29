import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getArtifacts, type PolicyArtifact } from '../api/client'

export function PolicyListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [selectedLob, setSelectedLob] = useState<string>('all')
  const [selectedEffectiveDate] = useState<string>('all')
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyArtifact | null>(null)

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

  const activeArtifact = selectedPolicy || filtered[0] || null

  return (
    <div className="flex-1 flex flex-col h-full bg-surface overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 bg-surface-container-lowest border-b border-outline-variant sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-6">
          <h2 className="font-headline-md text-headline-md font-black tracking-tight text-primary">Policy Intelligence Engine</h2>
          <div className="relative w-96 group">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-on-tertiary-container transition-colors">search</span>
            <input
              className="w-full bg-surface-container border border-outline-variant rounded-full py-1.5 pl-10 pr-4 text-body-md focus:outline-none focus:ring-2 focus:ring-on-tertiary-container transition-all"
              placeholder="Search NCD, LCD, or Payer Policies..."
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 text-xs">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-1.5 border border-outline-variant rounded-lg bg-surface-container-lowest text-on-surface font-label-md"
            >
              <option value="all">All Types</option>
              <option value="coverage_rule">Coverage Rule</option>
              <option value="cql_library">CQL Library</option>
              <option value="value_set">ValueSet</option>
            </select>
            <select
              value={selectedLob}
              onChange={(e) => setSelectedLob(e.target.value)}
              className="px-3 py-1.5 border border-outline-variant rounded-lg bg-surface-container-lowest text-on-surface font-label-md"
            >
              <option value="all">All LOBs</option>
              <option value="commercial">Commercial</option>
              <option value="medicare">Medicare</option>
              <option value="medicaid">Medicaid</option>
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 border border-outline-variant rounded-lg bg-surface-container-lowest text-on-surface font-label-md"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <button
            onClick={() => navigate('/new')}
            className="bg-primary text-on-primary px-5 py-2 rounded-lg font-label-md text-label-md hover:bg-opacity-90 active:opacity-80 transition-all flex items-center gap-2"
          >
            <span>Execute Rule</span>
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
          </button>
        </div>
      </header>

      {/* Dashboard Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center Section: Registry List & Simulation */}
        <section className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto">
          {/* Stats / Quick Insight Bar */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col">
              <span className="text-on-surface-variant font-label-md text-label-md uppercase">Total Active Policies</span>
              <span className="text-display font-display mt-1 font-bold text-slate-900">1,482</span>
              <div className="mt-2 flex items-center gap-1 text-on-secondary-container">
                <span className="material-symbols-outlined text-sm">trending_up</span>
                <span className="text-xs">+12 this month</span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col">
              <span className="text-on-surface-variant font-label-md text-label-md uppercase">ELM Compliance</span>
              <span className="text-display font-display mt-1 font-bold text-slate-900">99.8%</span>
              <div className="mt-2 flex items-center gap-1 text-on-secondary-container">
                <span className="material-symbols-outlined text-sm">verified</span>
                <span className="text-xs text-secondary font-semibold">Validated</span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col">
              <span className="text-on-surface-variant font-label-md text-label-md uppercase">Pending Sandbox</span>
              <span className="text-display font-display mt-1 font-bold text-slate-900">24</span>
              <div className="mt-2 flex items-center gap-1 text-tertiary-container">
                <span className="material-symbols-outlined text-sm">hourglass_empty</span>
                <span className="text-xs text-on-tertiary-container font-medium">Awaiting SIM</span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col">
              <span className="text-on-surface-variant font-label-md text-label-md uppercase">Impact Simulations</span>
              <span className="text-display font-display mt-1 font-bold text-slate-900">8,102</span>
              <div className="mt-2 flex items-center gap-1 text-on-surface-variant">
                <span className="material-symbols-outlined text-sm">dataset</span>
                <span className="text-xs">DIG-SIM Repository</span>
              </div>
            </div>
          </div>

          {/* Policy Table */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden flex flex-col flex-1 shadow-sm">
            <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-headline-md text-headline-md font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined">table_chart</span>
                Policy Registry
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('/reports')}
                  className="px-3 py-1.5 border border-outline-variant rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[18px]">description</span> Governance Reports
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              {isLoading ? (
                <div className="p-8 text-center text-on-surface-variant">Loading policy registry...</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-container-lowest sticky top-0">
                    <tr className="text-on-surface-variant font-label-md text-label-md border-b border-outline-variant">
                      <th className="px-6 py-4 font-semibold uppercase tracking-wider">Policy Identifier / Name</th>
                      <th className="px-6 py-4 font-semibold uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 font-semibold uppercase tracking-wider">Engine Version</th>
                      <th className="px-6 py-4 font-semibold uppercase tracking-wider">Effective Date</th>
                      <th className="px-6 py-4 font-semibold uppercase tracking-wider">LOB Source</th>
                      <th className="px-6 py-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/50">
                    {filtered.map((item) => {
                      const isSelected = activeArtifact?.id === item.id
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedPolicy(item)}
                          className={`transition-colors cursor-pointer group ${
                            isSelected
                              ? 'bg-surface-container-low border-l-4 border-on-tertiary-container'
                              : 'hover:bg-surface-container-low/50'
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-body-md text-body-md font-bold text-primary">{item.name}</span>
                              <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">{item.id}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-label-sm text-label-sm border ${
                              item.status === 'active'
                                ? 'bg-secondary-container text-on-secondary-container border-secondary/20'
                                : 'bg-tertiary-container text-on-tertiary-container border-on-tertiary-container/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${item.status === 'active' ? 'bg-secondary animate-pulse' : 'bg-on-tertiary-container'}`} />
                              {item.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-label-md text-label-md font-mono">{item.version}</td>
                          <td className="px-6 py-4 text-on-surface-variant text-body-md font-mono">{item.effective_date}</td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-1 bg-surface-container rounded font-label-sm text-label-sm border border-outline-variant font-bold uppercase">
                              {item.lob}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/policies/${item.id}`)
                              }}
                              className="p-1 hover:bg-surface-container-high rounded"
                            >
                              <span className="material-symbols-outlined text-outline group-hover:text-primary transition-colors">chevron_right</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Impact Analysis (Simulation) Section */}
          <div className="bg-primary-container text-white rounded-2xl p-6 relative overflow-hidden flex items-center gap-8 border border-white/10 shrink-0">
            <div className="relative z-10 flex-1">
              <h3 className="font-headline-md text-headline-md font-bold mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined">science</span>
                DIG-SIM Impact Analysis
              </h3>
              <p className="text-on-primary-container text-body-lg max-w-2xl">
                Test draft policies against 150k+ historical case sets to predict approval rate shifts and financial variance before deployment to production.
              </p>
            </div>
            <div className="relative z-10">
              <button
                onClick={() => navigate('/new')}
                className="bg-secondary-container text-on-secondary-container px-8 py-4 rounded-xl font-headline-md text-headline-md font-bold shadow-lg shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-3"
              >
                <span>Run Simulation</span>
                <span className="material-symbols-outlined font-black">bolt</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Section: Logic Preview Panel */}
        <aside className="w-96 border-l border-outline-variant bg-surface flex flex-col overflow-hidden shrink-0">
          <div className="p-4 border-b border-outline-variant bg-surface-container flex items-center justify-between">
            <span className="font-label-md text-label-md font-bold uppercase text-on-surface-variant">Logic Preview (CQL)</span>
            <div className="flex gap-2">
              <button
                onClick={() => activeArtifact && navigate(`/policies/${activeArtifact.id}`)}
                className="material-symbols-outlined text-on-surface-variant text-[20px] hover:text-primary"
              >
                open_in_full
              </button>
            </div>
          </div>
          <div className="flex-1 bg-[#1e293b] p-4 font-label-md text-label-md text-blue-100 overflow-auto cql-syntax font-mono text-xs leading-relaxed">
            <div className="mb-1"><span className="text-purple-400">library</span> {activeArtifact?.id.replace(/-/g, '_') || 'Policy_Rule'} <span className="text-blue-300">version</span> '{activeArtifact?.version || '1.0.0'}'</div>
            <div className="mb-1"><span className="text-purple-400">using</span> FHIR <span className="text-blue-300">version</span> '4.0.1'</div>
            <div className="mb-1"><span className="text-purple-400">include</span> FHIRHelpers <span className="text-blue-300">version</span> '4.0.1'</div>
            <div className="mb-1 text-slate-500">// Target Rule: {activeArtifact?.name}</div>
            <div className="mb-1"><span className="text-purple-400">define</span> <span className="text-yellow-200">"HasClinicalDiagnosis"</span>:</div>
            <div className="mb-1 pl-4 flex flex-col text-slate-300">
              <span>[Condition: "{activeArtifact?.name || 'Condition'}"] C</span>
              <span>where C.clinicalStatus ~ "active"</span>
            </div>
            <div className="mb-1"><span className="text-purple-400">define</span> <span className="text-yellow-200">"IsEligible"</span>:</div>
            <div className="mb-1 pl-4 flex flex-col text-slate-300">
              <span>"HasClinicalDiagnosis" <span className="text-blue-300">and</span></span>
              <span>"PriorAuthCriteriaMet"</span>
            </div>
            <div className="mb-1"><span className="text-purple-400">define</span> <span className="text-yellow-200">"PolicyResult"</span>:</div>
            <div className="mb-1 pl-4 flex flex-col text-slate-300">
              <span><span className="text-blue-300">if</span> "IsEligible" <span className="text-blue-300">then</span> 'Approve'</span>
              <span><span className="text-blue-300">else</span> 'Refer to Manual Review'</span>
            </div>
            <div className="mt-4 text-emerald-400">// end of logic segment</div>
          </div>
          <div className="p-6 bg-surface-container-low border-t border-outline-variant space-y-4">
            <div className="flex items-center justify-between text-label-md font-bold uppercase text-on-surface-variant mb-2">
              <span>Audit &amp; Source</span>
              <span className="text-secondary font-bold">Verified</span>
            </div>
            <div className="p-4 bg-white border border-outline-variant rounded-xl text-body-md">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-secondary">assignment_turned_in</span>
                <span className="font-bold text-sm text-slate-900">System of Record Integrity</span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                This rule is mapped to internal standard <strong>{activeArtifact?.id || 'POL-8821'}</strong>. Any changes require clinical analyst signature in Sandbox.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => activeArtifact && navigate(`/policies/${activeArtifact.id}`)}
                className="bg-surface-container-high py-2 rounded-lg font-label-md text-label-md hover:bg-outline-variant transition-colors text-center text-xs font-semibold"
              >
                Full Studio View
              </button>
              <button
                onClick={() => navigate('/reports')}
                className="bg-surface-container-high py-2 rounded-lg font-label-md text-label-md hover:bg-outline-variant transition-colors text-center text-xs font-semibold"
              >
                Ref Evidence
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
