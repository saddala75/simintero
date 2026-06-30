import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMeasureLibrary, activateMeasure, deactivateMeasure, type MeasureCatalogItem } from '../api/client'
import { Card, Badge, Button } from '@sim/design-system'

function BenchmarkBar({ benchmarks }: { benchmarks: MeasureCatalogItem['benchmarks'] }) {
  const pct = (v: number) => `${v}%`
  return (
    <div className="mt-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">National Benchmarks</div>
      <div className="relative h-5 bg-slate-100 rounded-full overflow-hidden">
        <div className="absolute inset-y-0 bg-gradient-to-r from-amber-200 via-emerald-200 to-emerald-400 rounded-full"
          style={{ left: pct(benchmarks.p25), right: `${100 - benchmarks.p90}%` }} />
        {[
          { val: benchmarks.p25, label: '25th' },
          { val: benchmarks.p50, label: '50th' },
          { val: benchmarks.p75, label: '75th' },
          { val: benchmarks.p90, label: '90th' },
        ].map(({ val, label }) => (
          <div key={label} className="absolute inset-y-0 w-px bg-slate-400/60" style={{ left: pct(val) }} />
        ))}
        <div className="absolute inset-y-0 w-0.5 bg-blue-500" style={{ left: pct(benchmarks.national_avg) }} />
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono text-slate-500">
        <span>25th: {benchmarks.p25}%</span>
        <span className="text-blue-600 font-bold">Avg: {benchmarks.national_avg}%</span>
        <span>50th: {benchmarks.p50}%</span>
        <span>75th: {benchmarks.p75}%</span>
        <span>90th: {benchmarks.p90}%</span>
      </div>
    </div>
  )
}

function programBadgeClass(program: string): string {
  switch (program) {
    case 'HEDIS': return 'bg-blue-100 text-blue-800'
    case 'CMS Stars': return 'bg-amber-100 text-amber-800'
    case 'QRS': return 'bg-purple-100 text-purple-800'
    case 'Medicaid': return 'bg-emerald-100 text-emerald-800'
    default: return 'bg-slate-100 text-slate-700'
  }
}

export function MeasureLibraryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterProgram, setFilterProgram] = useState('all')
  const [filterDomain, setFilterDomain] = useState('all')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const { data: measures = [], isLoading } = useQuery({
    queryKey: ['measure-library'],
    queryFn: getMeasureLibrary,
    staleTime: 30_000,
  })

  const domains = useMemo(() => {
    const s = new Set(measures.map((m: MeasureCatalogItem) => m.domain))
    return ['all', ...Array.from(s).sort()]
  }, [measures])

  const filtered = useMemo(() => {
    return measures.filter((m: MeasureCatalogItem) => {
      if (filterProgram !== 'all' && m.program !== filterProgram) return false
      if (filterDomain !== 'all' && m.domain !== filterDomain) return false
      if (filterActive === 'active' && !m.active) return false
      if (filterActive === 'inactive' && m.active) return false
      if (search) {
        const q = search.toLowerCase()
        return m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
      }
      return true
    })
  }, [measures, filterProgram, filterDomain, filterActive, search])

  const activeMut = useMutation({
    mutationFn: (id: string) => activateMeasure(id),
    onSuccess: () => {
      setSuccessMsg('Measure activated successfully.')
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ['measure-library'] })
      queryClient.invalidateQueries({ queryKey: ['measures'] })
    },
    onError: (err: unknown) => {
      const msg = String(err)
      setErrorMsg(msg.includes('403')
        ? 'Medical Director role required to activate measures.'
        : 'Failed to activate measure. Please try again.')
    },
  })

  const deactivateMut = useMutation({
    mutationFn: (id: string) => deactivateMeasure(id),
    onSuccess: () => {
      setSuccessMsg('Measure deactivated.')
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: ['measure-library'] })
      queryClient.invalidateQueries({ queryKey: ['measures'] })
    },
    onError: (err: unknown) => {
      const msg = String(err)
      setErrorMsg(msg.includes('403')
        ? 'Medical Director role required to deactivate measures.'
        : 'Failed to deactivate measure. Please try again.')
    },
  })

  const activeCount = measures.filter((m: MeasureCatalogItem) => m.active).length

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/qualitron')}>
              &larr; Back to Dashboard
            </Button>
            <div>
              <h1 className="text-2xl font-black text-slate-900">Measure Library</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Browse authoritative quality measures and activate them for your organization.
                <span className="ml-2 font-semibold text-slate-700">{activeCount} of {measures.length} activated</span>
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-500 text-right">
            <div className="font-bold text-slate-700">Sources</div>
            <div>NCQA HEDIS 2026 &middot; CMS Stars 2026</div>
            <div>Exchange QRS 2026 &middot; CMS Medicaid Core Set 2026</div>
          </div>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-800 flex items-center justify-between">
            <span>&#9888; {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="font-bold text-xs ml-4">&#x2715;</button>
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex items-center justify-between">
            <span>&#10003; {successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="font-bold text-xs ml-4">&#x2715;</button>
          </div>
        )}

        {/* Filter bar */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
            <input
              type="search"
              placeholder="Search by code or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <label className="flex items-center gap-2">
              Program:
              <select value={filterProgram} onChange={e => setFilterProgram(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md bg-white font-semibold">
                <option value="all">All Programs</option>
                <option value="HEDIS">HEDIS</option>
                <option value="CMS Stars">CMS Stars</option>
                <option value="QRS">Exchange QRS</option>
                <option value="Medicaid">Medicaid</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Domain:
              <select value={filterDomain} onChange={e => setFilterDomain(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-md bg-white font-semibold">
                {(domains as string[]).map((d: string) => <option key={d} value={d}>{d === 'all' ? 'All Domains' : d}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Status:
              <select value={filterActive} onChange={e => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
                className="px-3 py-1.5 border border-slate-300 rounded-md bg-white font-semibold">
                <option value="all">All</option>
                <option value="active">Activated</option>
                <option value="inactive">Not Activated</option>
              </select>
            </label>
            <span className="ml-auto text-slate-400 font-mono">{filtered.length} measure{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </Card>

        {/* Measure cards */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">Loading measure library...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {(filtered as MeasureCatalogItem[]).map((m: MeasureCatalogItem) => (
              <Card key={m.id} className={`p-5 border transition-all ${m.active ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200'}`}>
                {/* Card header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-xs font-black text-slate-700">{m.code}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${programBadgeClass(m.program)}`}>{m.program}</span>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{m.domain}</span>
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm leading-snug">{m.name}</h3>
                  </div>
                  {m.active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivateMut.mutate(m.id)}
                      className="shrink-0 text-slate-500 border border-slate-200"
                    >
                      &#10003; Active &middot; Remove
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => activeMut.mutate(m.id)}
                      className="shrink-0"
                    >
                      + Activate
                    </Button>
                  )}
                </div>

                {/* Description */}
                <p className="text-xs text-slate-600 leading-relaxed mb-3">{m.description}</p>

                {/* Num / Denom */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
                  <div className="bg-slate-50 rounded p-2 border border-slate-100">
                    <div className="font-bold text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">Numerator</div>
                    <div className="text-slate-700">{m.numerator_desc}</div>
                  </div>
                  <div className="bg-slate-50 rounded p-2 border border-slate-100">
                    <div className="font-bold text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">Denominator</div>
                    <div className="text-slate-700">{m.denominator_desc}</div>
                  </div>
                </div>

                {/* Benchmark bar */}
                <BenchmarkBar benchmarks={m.benchmarks} />

                {/* Footer */}
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>{m.source_version}</span>
                  <span>{m.reporting_period}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
