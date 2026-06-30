import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, Badge, Button } from '@sim/design-system'
import { getAiPerformance, type AiPerformanceData, type AiCaseRecord } from '../api/client'

function groundednessColor(score: number): string {
  if (score >= 0.75) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (score >= 0.50) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

function groundednessBarColor(score: number): string {
  if (score >= 0.75) return 'bg-emerald-500'
  if (score >= 0.50) return 'bg-amber-500'
  return 'bg-red-500'
}

function pct(val: number): string {
  return (val * 100).toFixed(0) + '%'
}

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  highlight?: 'good' | 'warn' | 'bad' | 'neutral'
}

function KpiCard({ label, value, sub, highlight = 'neutral' }: KpiCardProps) {
  const colors: Record<string, string> = {
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
    neutral: 'text-slate-900',
  }
  return (
    <Card className="p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-black ${colors[highlight]}`}>{value}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </Card>
  )
}

export function RevitalPage() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-performance'],
    queryFn: getAiPerformance,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F9FB] flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading AI performance data...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F7F9FB] flex items-center justify-center">
        <div className="text-red-500 text-sm">Failed to load AI performance data.</div>
      </div>
    )
  }

  const s = data.summary
  const maxCitations = Math.max(...data.top_evidence_sources.map((e) => e.citations))
  const maxCases = Math.max(...data.weekly_trend.map((w) => w.cases))

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-slate-900">Revital AI — Performance &amp; Oversight</h1>
          <p className="text-sm text-slate-500 mt-1">
            Aggregate metrics across all AI-assisted prior authorization reviews
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard label="Cases AI-Reviewed" value={s.total_reviewed} sub="total reviewed" highlight="neutral" />
          <KpiCard
            label="Avg Groundedness"
            value={pct(s.avg_groundedness)}
            sub="evidence quality"
            highlight={s.avg_groundedness >= 0.75 ? 'good' : s.avg_groundedness >= 0.5 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Completeness Rate"
            value={pct(s.avg_completeness_rate)}
            sub="evidence coverage"
            highlight={s.avg_completeness_rate >= 0.75 ? 'good' : s.avg_completeness_rate >= 0.5 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Citation Acceptance"
            value={pct(s.citation_acceptance_rate)}
            sub="reviewer acceptance"
            highlight={s.citation_acceptance_rate >= 0.75 ? 'good' : s.citation_acceptance_rate >= 0.5 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="AI-Human Alignment"
            value={pct(s.alignment_rate)}
            sub="decision agreement"
            highlight={s.alignment_rate >= 0.75 ? 'good' : s.alignment_rate >= 0.5 ? 'warn' : 'bad'}
          />
          <KpiCard
            label="Needs Review"
            value={s.cases_needing_review}
            sub="low confidence"
            highlight={s.cases_needing_review > 0 ? 'bad' : 'good'}
          />
        </div>

        {/* Main content: cases + evidence */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Cases */}
          <Card className="lg:col-span-2 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent AI-Reviewed Cases</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left font-medium text-slate-500 py-2 pr-3">Member</th>
                    <th className="text-left font-medium text-slate-500 py-2 pr-3">Service</th>
                    <th className="text-left font-medium text-slate-500 py-2 pr-3">Groundedness</th>
                    <th className="text-center font-medium text-slate-500 py-2 pr-3">Cit / Gaps / Conf</th>
                    <th className="text-center font-medium text-slate-500 py-2 pr-3">AI Rec</th>
                    <th className="text-center font-medium text-slate-500 py-2 pr-3">Decision</th>
                    <th className="text-center font-medium text-slate-500 py-2">Aligned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_cases.map((row) => (
                    <tr
                      key={row.case_id}
                      onClick={() => navigate('/cases/' + row.case_id)}
                      className={`cursor-pointer border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                        row.aligned === false ? 'bg-red-50' : ''
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-medium text-slate-800">{row.member_name}</td>
                      <td className="py-2.5 pr-3 text-slate-600 max-w-[140px] truncate">{row.service}</td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${groundednessBarColor(row.groundedness)}`}
                              style={{ width: `${row.groundedness * 100}%` }}
                            />
                          </div>
                          <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${groundednessColor(row.groundedness)}`}>
                            {pct(row.groundedness)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-center text-slate-600">
                        <span className="text-emerald-700">{row.citations_count}</span>
                        {' / '}
                        <span className={row.gaps_count > 0 ? 'text-amber-700' : 'text-slate-400'}>{row.gaps_count}</span>
                        {' / '}
                        <span className={row.conflicts_count > 0 ? 'text-red-700' : 'text-slate-400'}>{row.conflicts_count}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        {row.ai_recommendation ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              row.ai_recommendation === 'approve'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {row.ai_recommendation}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.human_decision === 'approved'
                              ? 'bg-emerald-100 text-emerald-700'
                              : row.human_decision === 'denied'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {row.human_decision}
                        </span>
                      </td>
                      <td className="py-2.5 text-center">
                        {row.aligned === true ? (
                          <span className="text-emerald-600 font-bold">✓</span>
                        ) : row.aligned === false ? (
                          <span className="text-red-600 font-bold">✗</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Evidence Sources */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Evidence Sources</h3>
            <div className="space-y-3">
              {data.top_evidence_sources.map((src, idx) => (
                <div key={idx}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs text-slate-700 font-medium leading-tight flex-1 pr-2">{src.title}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{src.citations} cit</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 rounded-full"
                      style={{ width: `${(src.citations / maxCitations) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{src.cases} cases</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Weekly Trend */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-6">Weekly AI Review Volume &amp; Groundedness Trend</h3>
          <div className="flex items-end gap-4 h-32">
            {data.weekly_trend.map((w, idx) => {
              const barHeight = maxCases > 0 ? (w.cases / maxCases) * 100 : 0
              const barColor = groundednessBarColor(w.avg_groundedness)
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-slate-500">{pct(w.avg_groundedness)}</span>
                  <div className="w-full flex items-end" style={{ height: '80px' }}>
                    <div
                      className={`w-full rounded-t ${barColor} opacity-80 transition-all`}
                      style={{ height: `${barHeight}%` }}
                      title={`${w.cases} cases, ${pct(w.avg_groundedness)} groundedness`}
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-medium">{w.cases}</span>
                  <span className="text-xs text-slate-400">{w.week}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Groundedness ≥ 75%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /> 50–75%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> &lt; 50%</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
