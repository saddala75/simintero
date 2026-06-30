import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDashboard, type DashboardMyCase, type DashboardActivity } from '../api/client'
import { Card, Button } from '@sim/design-system'
import { useAuth, hasRole } from '../auth/AuthContext'

const LOB_COLOR: Record<string, string> = {
  medicare:   'bg-amber-50  text-amber-700  border-amber-200',
  commercial: 'bg-blue-50   text-blue-700   border-blue-200',
  medicaid:   'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  approved:   { label: 'Approved',     color: 'text-emerald-700' },
  denied:     { label: 'Denied',       color: 'text-red-700' },
  sent_rfi:   { label: 'Sent RFI',     color: 'text-blue-700' },
  sla_breach: { label: 'SLA Breach',   color: 'text-orange-700' },
}

function slaColor(hours: number) {
  if (hours <= 4)  return 'text-red-600 font-bold'
  if (hours <= 12) return 'text-amber-600 font-semibold'
  return 'text-slate-600'
}

function slaLabel(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m left`
  return `${hours.toFixed(1)}h left`
}

interface KpiCardProps {
  label: string
  value: string | number
  sub: string
  subColor?: string
  onClick?: () => void
  alert?: boolean
}

function KpiCard({ label, value, sub, subColor = 'text-slate-500', onClick, alert }: KpiCardProps) {
  return (
    <Card
      className={`p-5 cursor-pointer hover:shadow-md transition-all ${alert ? 'border-red-200 bg-red-50/30' : ''}`}
      onClick={onClick}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`text-3xl font-black tabular-nums ${alert ? 'text-red-700' : 'text-slate-900'}`}>{value}</div>
      <div className={`text-xs mt-1.5 font-medium ${subColor}`}>{sub}</div>
    </Card>
  )
}

interface ProductTileProps {
  glyph: string
  code: string
  name: string
  description: string
  href: string
  color: string
}

function ProductTile({ glyph, code, name, description, href, color }: ProductTileProps) {
  const navigate = useNavigate()
  return (
    <Card
      className="p-6 cursor-pointer hover:shadow-lg transition-all group"
      onClick={() => navigate(href)}
    >
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0 ${color}`}>
          {glyph}
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{code}</div>
          <div className="font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">{name}</div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</div>
        </div>
        <span className="ml-auto text-slate-300 group-hover:text-slate-500 transition-colors text-xl self-start">›</span>
      </div>
    </Card>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const auth = useAuth()
  const isMedicalDirector = hasRole(auth, 'medical_director')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-[#F7F9FB] p-8 flex items-center justify-center">
        <div className="text-slate-500">Loading dashboard…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F9FB] p-8">
      <div className="max-w-[1280px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">{greeting}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {isMedicalDirector ? 'Medical Director view · ' : ''}
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/worklist')}>
            Open My Worklist →
          </Button>
        </div>

        {/* Platform KPI strip */}
        <div className="grid grid-cols-5 gap-4">
          <KpiCard
            label="Open Queue"
            value={data.queue.total_open}
            sub={`${data.queue.urgent} urgent`}
            subColor="text-red-600"
            alert={data.queue.urgent > 3}
            onClick={() => navigate('/worklist')}
          />
          <KpiCard
            label="SLA at Risk"
            value={data.queue.sla_at_risk}
            sub={`Avg age ${data.queue.avg_age_hours.toFixed(1)}h`}
            subColor={data.queue.sla_at_risk > 0 ? 'text-orange-600' : 'text-slate-500'}
            alert={data.queue.sla_at_risk > 1}
            onClick={() => navigate('/worklist')}
          />
          <KpiCard
            label="AI Groundedness"
            value={`${(data.ai.avg_groundedness * 100).toFixed(0)}%`}
            sub={`${data.ai.cases_reviewed_today} cases today`}
            subColor="text-slate-500"
            onClick={() => navigate('/revital')}
          />
          <KpiCard
            label="Active Policies"
            value={data.policies.active.toLocaleString()}
            sub={`${data.policies.drafts_pending} pending review`}
            subColor="text-slate-500"
            onClick={() => navigate('/digicore')}
          />
          <KpiCard
            label="Care Gaps Open"
            value={data.quality.care_gaps_open}
            sub={`Top gap: ${data.quality.top_gap_measure}`}
            subColor="text-slate-500"
            onClick={() => navigate('/qualitron/gaps')}
          />
        </div>

        {/* Main two-column */}
        <div className="grid grid-cols-3 gap-6">

          {/* My Queue — 2/3 */}
          <div className="col-span-2 space-y-4">
            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">My Queue</h2>
                <button
                  onClick={() => navigate('/worklist')}
                  className="text-xs text-blue-600 hover:underline font-semibold"
                >
                  View all →
                </button>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="px-6 py-3">Case / Member</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">LOB</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">SLA</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.my_cases.map((c: DashboardMyCase) => (
                    <tr
                      key={c.case_id}
                      onClick={() => navigate(`/cases/${c.case_id}`)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <td className="px-6 py-3.5">
                        {c.priority === 'urgent' && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-2 mb-0.5" />
                        )}
                        <span className="font-semibold text-sm text-slate-900">{c.member_name}</span>
                        <div className="text-[11px] font-mono text-slate-400">{c.case_id}</div>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-slate-600">{c.request_type}</td>
                      <td className="px-6 py-3.5">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${LOB_COLOR[c.lob] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {c.lob}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-xs text-slate-600">{c.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td className={`px-6 py-3.5 text-xs tabular-nums ${slaColor(c.sla_remaining_hours)}`}>
                        {slaLabel(c.sla_remaining_hours)}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className="text-slate-300 group-hover:text-slate-500 transition-colors">›</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Appeals + Grievances alert row */}
            {(data.appeals.overdue > 0 || data.grievances.unacknowledged > 0) && (
              <div className="grid grid-cols-2 gap-4">
                {data.appeals.overdue > 0 && (
                  <Card
                    className="p-4 border-orange-200 bg-orange-50/40 cursor-pointer hover:shadow-md"
                    onClick={() => navigate('/appeals')}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-0.5">Appeals</div>
                        <div className="font-bold text-slate-900">{data.appeals.open} open · <span className="text-orange-700">{data.appeals.overdue} overdue</span></div>
                      </div>
                      <span className="text-orange-400 text-xl">›</span>
                    </div>
                  </Card>
                )}
                {data.grievances.unacknowledged > 0 && (
                  <Card
                    className="p-4 border-amber-200 bg-amber-50/40 cursor-pointer hover:shadow-md"
                    onClick={() => navigate('/grievances')}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-0.5">Grievances</div>
                        <div className="font-bold text-slate-900">{data.grievances.open} open · <span className="text-amber-700">{data.grievances.unacknowledged} unacknowledged</span></div>
                      </div>
                      <span className="text-amber-400 text-xl">›</span>
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>

          {/* Recent Activity — 1/3 */}
          <div>
            <Card className="overflow-hidden h-full">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Recent Activity</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {data.recent_activity.map((a: DashboardActivity, i: number) => {
                  const meta = ACTION_LABEL[a.action] ?? { label: a.action, color: 'text-slate-600' }
                  return (
                    <div
                      key={i}
                      className="px-5 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/cases/${a.case_id}`)}
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className={`text-xs font-bold ${meta.color}`}>{meta.label}</span>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">{a.time}</span>
                      </div>
                      <div className="text-xs text-slate-700 font-medium">{a.member_name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {a.actor} · <span className="font-mono">{a.case_id}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>

        {/* Product navigation tiles */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Platform</div>
          <div className="grid grid-cols-4 gap-4">
            <ProductTile
              glyph="E"
              code="Enstellar"
              name="PA / UM Worklist"
              description="Case review, RFI, decisions, regulatory clocks"
              href="/worklist"
              color="bg-slate-800"
            />
            <ProductTile
              glyph="D"
              code="Digicore"
              name="Policy Intelligence"
              description="Coverage rules, CQL libraries, governance"
              href="/digicore"
              color="bg-indigo-600"
            />
            <ProductTile
              glyph="R"
              code="Revital AI"
              name="AI Performance"
              description="Groundedness, evidence gaps, oversight"
              href="/revital"
              color="bg-violet-600"
            />
            <ProductTile
              glyph="Q"
              code="Qualitron"
              name="Quality Console"
              description="HEDIS, Stars, care gaps, measure library"
              href="/qualitron"
              color="bg-emerald-600"
            />
          </div>
        </div>

      </div>
    </div>
  )
}
