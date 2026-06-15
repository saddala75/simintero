import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getWorklist, getQueueStats } from '../api/client'
import type { WorklistItem, SlaInfo, QueueStats } from '../types'

// ── helpers ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

function slaClock(sla: SlaInfo | null): { text: string; cls: string } {
  if (!sla) return { text: '—', cls: 'done' }
  if (sla.paused) return { text: 'Paused', cls: 'paused' }
  const cls = sla.rag === 'green' ? 'ok' : sla.rag === 'amber' ? 'warn' : 'crit'
  const h = sla.hours_remaining
  if (h >= 48) {
    const d = Math.floor(h / 24)
    const r = Math.floor(h % 24)
    return { text: `${d}d ${pad(r)}:00`, cls }
  }
  return { text: `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`, cls }
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  clinical_review: { label: 'In review', cls: 'review' },
  pend_rfi: { label: 'Awaiting info', cls: 'info' },
  completeness_check: { label: 'Completeness', cls: 'info' },
  md_review: { label: 'Pending det.', cls: 'md' },
  approved: { label: 'Approved', cls: 'decided' },
  denied: { label: 'Denied', cls: 'decided' },
  partially_denied: { label: 'Partial denial', cls: 'decided' },
  adverse_modification: { label: 'Modification', cls: 'decided' },
  intake: { label: 'Intake', cls: 'info' },
}

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
  if (lob.includes('medicare')) return 'X12'
  if (lob.includes('medicaid')) return 'X12'
  return 'FHIR'
}

function shortId(caseId: string): string {
  return `PA-${caseId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

// ── Topbar ────────────────────────────────────────────────────────────────────

function Topbar() {
  return (
    <div className="en-topbar">
      <span className="en-brand">
        <svg className="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="6" stroke="#74DBC8" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="3.4" fill="#74DBC8" />
        </svg>
        Enstellar
      </span>
      <span className="en-breadcrumb"><b>Utilization Management</b></span>
      <div className="en-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Search cases, members, providers…
      </div>
      <div className="en-topright">
        <span className="en-env">TENANT · DEV</span>
        <span className="en-ai-global"><span className="dot" />Governed AI · on</span>
        <span className="en-avatar" title="Reviewer">AP</span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

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

  const aiDet = queueStats?.ai_determinations ?? 0
  const adversePct = isFinite(queueStats?.adverse_human_signed_pct ?? 0)
    ? (queueStats?.adverse_human_signed_pct ?? 0)
    : 0
  const slaPct = isFinite(queueStats?.sla_compliance_expedited_pct ?? 0)
    ? (queueStats?.sla_compliance_expedited_pct ?? 0)
    : 0

  const items = data?.items ?? []

  // Derived counts for stat band
  const counts = useMemo(() => {
    const inReview = items.filter(i => i.status === 'clinical_review').length
    const awaitingInfo = items.filter(i => i.status === 'pend_rfi' || i.status === 'completeness_check').length
    const pendingMd = items.filter(i => i.status === 'md_review').length
    const decided = items.filter(i => DECIDED.has(i.status)).length
    const breaching = items.filter(i => i.sla?.rag === 'red' && !i.sla?.paused).length
    const dueToday = items.filter(i => {
      if (!i.sla || i.sla.paused) return false
      return i.sla.hours_remaining <= 24
    }).length
    return { total: items.length, inReview, awaitingInfo, pendingMd, decided, breaching, dueToday }
  }, [items])

  const filtered = useMemo(() => items.filter(i => tabFilter(i, activeTab)), [items, activeTab])

  const mdPending = useMemo(() => items.filter(i => i.status === 'md_review'), [items])

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="en-app">
      <Topbar />
      <div className="en-scroll">
        <div className="en-wrap">
          {/* page header */}
          <div className="en-page-h">
            <div>
              <h1>Utilization Management</h1>
              <div className="sub">Prior authorization · live review queue</div>
            </div>
            <div className="date">{dateStr}</div>
          </div>

          {/* stat band */}
          <div className="en-stats">
            <div className="en-stat">
              <div className="v">{isLoading ? '…' : counts.total}</div>
              <div className="l">In queue</div>
            </div>
            <div className={`en-stat ${counts.dueToday > 0 ? 'warn' : ''}`}>
              <div className="v">{isLoading ? '…' : counts.dueToday}</div>
              <div className="l">Due today</div>
            </div>
            <div className={`en-stat ${counts.breaching > 0 ? 'alert' : ''}`}>
              <div className="v">{isLoading ? '…' : counts.breaching}</div>
              <div className="l">Breaching &lt; 4h</div>
            </div>
            <div className="en-stat">
              <div className="v">{isLoading ? '…' : counts.awaitingInfo}</div>
              <div className="l">Awaiting info</div>
            </div>
            <div className="en-stat">
              <div className="v">{isLoading ? '…' : counts.decided}</div>
              <div className="l">Decided</div>
            </div>
            <div className="en-gauge-card">
              <svg viewBox="0 0 120 70" fill="none" aria-hidden="true">
                <path d="M8 64 A52 52 0 0 1 112 64" stroke="rgba(255,255,255,.25)" strokeWidth="9" strokeLinecap="round" pathLength="100" />
                <path d="M8 64 A52 52 0 0 1 112 64" stroke="#74DBC8" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray={`${slaPct} 100`} />
              </svg>
              <div>
                <div className="gv">{slaPct.toFixed(1)}%</div>
                <div className="gl">expedited clock compliance, this period</div>
              </div>
            </div>
          </div>

          {/* main grid */}
          <div className="en-grid">
            {/* queue panel */}
            <section className="en-queue">
              <div className="en-queue-h">
                {[
                  { id: 'all', label: 'All', count: counts.total },
                  { id: 'review', label: 'In review', count: counts.inReview },
                  { id: 'info', label: 'Awaiting info', count: counts.awaitingInfo },
                  { id: 'md', label: 'Pending determination', count: counts.pendingMd },
                  { id: 'decided', label: 'Decided', count: counts.decided },
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`en-tab${activeTab === tab.id ? ' active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label} <span className="c">{tab.count}</span>
                  </button>
                ))}
              </div>

              {isLoading && (
                <div style={{ padding: '32px 16px', color: 'var(--ink-mut)', fontSize: 13 }}>
                  Loading worklist…
                </div>
              )}
              {isError && (
                <div role="alert" style={{ padding: '32px 16px', color: 'var(--red)', fontSize: 13 }}>
                  {(error as Error).message}
                </div>
              )}
              {!isLoading && !isError && filtered.length === 0 && (
                <div style={{ padding: '32px 16px', color: 'var(--ink-mut)', fontSize: 13 }}>
                  No cases in this view.
                </div>
              )}
              {!isLoading && !isError && filtered.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Member</th>
                      <th>Service</th>
                      <th>Ch</th>
                      <th>State</th>
                      <th>Clock</th>
                      <th>Reviewer</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => {
                      const st = STATUS_MAP[item.status] ?? { label: item.status, cls: 'info' }
                      const clk = slaClock(item.sla)
                      const exp = isExpedited(item.urgency)
                      return (
                        <tr
                          key={item.case_id}
                          data-testid={`worklist-row-${item.case_id}`}
                          onClick={() => navigate(`/cases/${item.case_id}`)}
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter') navigate(`/cases/${item.case_id}`) }}
                        >
                          <td>
                            <span className="en-cid">
                              <span className={`en-pri-dot ${exp ? 'exp' : 'std'}`} />
                              {shortId(item.case_id)}
                            </span>
                          </td>
                          <td>
                            <div className="en-mname">{item.member_name}</div>
                            <div className="en-mmeta">{item.lob.replace(/_/g, ' ')}</div>
                          </td>
                          <td style={{ fontWeight: 500 }}>{item.service_description}</td>
                          <td><span className="en-ch">{lobToChannel(item.lob)}</span></td>
                          <td><span className={`en-stbadge ${st.cls}`}>{st.label}</span></td>
                          <td><span className={`en-clk ${clk.cls}`}>{clk.text}</span></td>
                          <td>
                            <div className="en-rev un"><span className="ra">—</span></div>
                          </td>
                          <td className="en-go">→</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>

            {/* right rail */}
            <aside>
              {mdPending.length > 0 && (
                <div className="en-rail-card">
                  <div className="en-rc-h">
                    <span className="t">Pending MD determination</span>
                    <span className="cnt">{mdPending.length}</span>
                  </div>
                  <div className="en-rc-b">
                    {mdPending.map(item => {
                      const clk = slaClock(item.sla)
                      return (
                        <button
                          key={item.case_id}
                          className="en-esc"
                          onClick={() => navigate(`/cases/${item.case_id}`)}
                        >
                          <div className="et">
                            <span className="eid">{shortId(item.case_id)}</span>
                            <span className={`en-clk ${clk.cls}`}>{clk.text}</span>
                          </div>
                          <div className="esvc">{item.service_description}</div>
                          <div className="em">{item.member_name} · {item.urgency}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="en-rail-card">
                <div className="en-rc-h"><span className="t">Governed AI · guardrails</span></div>
                <div className="en-ai-stat">
                  <div className="row"><span className="k">Determinations made by AI</span><span className="n">{aiDet}</span></div>
                  <div className="row"><span className="k">Adverse decisions human-signed</span><span className="n">{adversePct.toFixed(1)}%</span></div>
                  <div className="row"><span className="k">AI advisory: status</span><span className="n" style={{ color: 'var(--amber)' }}>Pending</span></div>
                  <div className="en-ai-bound">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <rect x="3" y="7" width="10" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    AI never issues a determination
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
