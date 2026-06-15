import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCase, getCaseDocuments, getCriteria, getSuggestions, getWorklist, postRfi, postSuggestionAction } from '../api/client'
import type { AdverseOutcome, CaseDetail, CriterionItem, SlaInfo, SuggestionItem, WorklistItem } from '../types'
import { DecisionForm } from '../components/DecisionForm'
import { MdAdverseForm } from '../components/MdAdverseForm'

// ── helpers ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')

function formatCountdown(secs: number): string {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function slaClass(sla: SlaInfo | null): string {
  if (!sla || sla.paused) return 'paused'
  return sla.rag === 'green' ? 'ok' : sla.rag === 'amber' ? 'warn' : 'crit'
}

function slaClock(sla: SlaInfo | null): { text: string; cls: string } {
  if (!sla) return { text: '—', cls: 'done' }
  if (sla.paused) return { text: 'Paused', cls: 'paused' }
  const cls = sla.rag === 'green' ? 'ok' : sla.rag === 'amber' ? 'warn' : 'crit'
  const h = sla.hours_remaining
  const d = Math.floor(h / 24)
  const rh = Math.floor(h % 24)
  if (d > 0) return { text: `${d}d ${pad(rh)}:00`, cls }
  return { text: `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`, cls }
}

const STATUS_LABEL: Record<string, string> = {
  clinical_review: 'In clinical review',
  pend_rfi: 'Awaiting info',
  completeness_check: 'Completeness check',
  md_review: 'Pending determination',
  approved: 'Approved',
  denied: 'Denied',
  partially_denied: 'Partially denied',
  adverse_modification: 'Adverse modification',
  intake: 'Intake',
}

function statusCls(status: string): string {
  if (status === 'md_review') return 'md'
  if (
    ['approved', 'denied', 'partially_denied', 'adverse_modification'].includes(
      status,
    )
  )
    return 'done'
  if (status === 'pend_rfi') return 'rfi'
  return ''
}

function memberName(member: Record<string, unknown>): string {
  const first =
    typeof member.first_name === 'string' ? member.first_name : ''
  const last = typeof member.last_name === 'string' ? member.last_name : ''
  return [first, last].filter(Boolean).join(' ') || 'Unknown member'
}

function shortId(caseId: string): string {
  return `PA-${caseId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

// ── Topbar ────────────────────────────────────────────────────────────────────

function Topbar({ status }: { status: string }) {
  const isMd = status === 'md_review'
  return (
    <div className="en-topbar">
      <span className="en-brand">
        <svg
          className="mark"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="2"
            y="2"
            width="20"
            height="20"
            rx="6"
            stroke="#74DBC8"
            strokeWidth="1.6"
          />
          <circle cx="12" cy="12" r="3.4" fill="#74DBC8" />
        </svg>
        Enstellar
      </span>
      <span className="en-breadcrumb">
        Utilization Mgmt &nbsp;/&nbsp; Clinical Review &nbsp;/&nbsp;{' '}
        <b>{isMd ? 'Determination' : 'Review'}</b>
      </span>
      <div className="en-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M11 11l3 3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Search cases, members, providers…
      </div>
      <div className="en-topright">
        <span className="en-env">TENANT · DEV</span>
        <span className="en-ai-global">
          <span className="dot" />
          Governed AI · on
        </span>
        <span className="en-avatar" title={isMd ? 'Medical Director' : 'Reviewer'}>
          {isMd ? 'MD' : 'AP'}
        </span>
      </div>
    </div>
  )
}

// ── SLA countdown hook ────────────────────────────────────────────────────────

function useSlaCountdown(sla: SlaInfo | null): number {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!sla || sla.paused) return
    const deadline = new Date(sla.deadline).getTime()
    const tick = () =>
      setSecs(Math.max(0, Math.floor((deadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sla])
  return secs
}

// ── Worklist rail ─────────────────────────────────────────────────────────────

function WorklistRail({
  currentCaseId,
  collapsed,
}: {
  currentCaseId: string
  collapsed: boolean
}) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['worklist', 'default', 1],
    queryFn: () => getWorklist('default', 1),
    staleTime: 30_000,
  })
  const items = data?.items ?? []

  return (
    <aside className={`en-rail${collapsed ? ' collapsed' : ''}`}>
      <div className="en-rail-head">
        <div className="t">My queue</div>
        <div className="s">{items.length} cases · sorted by SLA risk</div>
      </div>
      <div className="en-rail-list">
        {items.map((item: WorklistItem) => {
          const clk = slaClock(item.sla)
          const active = item.case_id === currentCaseId
          return (
            <button
              key={item.case_id}
              className={`en-qitem${active ? ' active' : ''}`}
              onClick={() => navigate(`/cases/${item.case_id}`)}
            >
              <div className="qtop">
                <span className="qid">{shortId(item.case_id)}</span>
                <span className={`en-clk ${clk.cls}`}>{clk.text}</span>
              </div>
              <div className="qsvc">{item.service_description}</div>
              <div className="qmeta">
                {item.member_name} · {item.urgency}
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

// ── Context column ────────────────────────────────────────────────────────────

function ContextColumn({ caseData }: { caseData: CaseDetail }) {
  const m = caseData.member as Record<string, unknown>
  const c = caseData.coverage as Record<string, unknown>
  const name = memberName(m)
  const dob = typeof m.date_of_birth === 'string' ? m.date_of_birth : '—'
  const mrn = typeof m.mrn === 'string' ? m.mrn : '—'
  const payer = typeof c.payer_name === 'string' ? c.payer_name : '—'
  const plan = typeof c.plan_id === 'string' ? c.plan_id : '—'
  const lob =
    typeof c.lob === 'string'
      ? c.lob.replace(/_/g, ' ')
      : caseData.lob

  return (
    <section className="en-col ctx">
      {/* Member & coverage */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Member &amp; coverage</span>
        </div>
        <div className="en-panel-b">
          <div className="en-kv">
            <span className="k">Name</span>
            <span className="v">{name}</span>
          </div>
          <div className="en-kv">
            <span className="k">DOB</span>
            <span className="v">{dob}</span>
          </div>
          <div className="en-kv">
            <span className="k">MRN</span>
            <span
              className="v"
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
            >
              {mrn}
            </span>
          </div>
          <div className="en-kv">
            <span className="k">Payer</span>
            <span className="v">{payer}</span>
          </div>
          <div className="en-kv">
            <span className="k">Plan</span>
            <span className="v">{plan}</span>
          </div>
          <div className="en-kv">
            <span className="k">LOB</span>
            <span className="v">{lob}</span>
          </div>
          <div className="en-kv">
            <span className="k">Eligibility</span>
            <span className="v">
              <span className="en-pillbadge">Active</span>
            </span>
          </div>
        </div>
      </div>

      {/* Service lines */}
      <div className="en-panel" data-testid="service-lines-panel">
        <div className="en-panel-h">
          <span className="pt">Requested service</span>
          <span className="lbl">
            {caseData.service_lines.length} line
            {caseData.service_lines.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="en-panel-b">
          {caseData.service_lines.length === 0 ? (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
              No service lines.
            </p>
          ) : (
            caseData.service_lines.map((sl, i) => {
              const code =
                typeof sl.procedure_code === 'string'
                  ? sl.procedure_code
                  : '—'
              const desc =
                typeof sl.procedure_description === 'string'
                  ? sl.procedure_description
                  : '—'
              const dx = Array.isArray(sl.diagnosis_codes)
                ? (sl.diagnosis_codes as string[]).join(', ')
                : '—'
              return (
                <div key={i} className="en-svcline">
                  <span className="code">{code}</span>
                  <div className="name">{desc}</div>
                  <div className="meta">
                    Dx: {dx} · {caseData.urgency} ·{' '}
                    {caseData.lob.replace(/_/g, ' ')}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Provenance */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Provenance</span>
        </div>
        <div className="en-panel-b">
          <div className="en-prov">
            case &nbsp;<b>{shortId(caseData.case_id)}</b>
            <br />
            id &nbsp;
            <b style={{ fontSize: 10 }}>{caseData.case_id}</b>
            <br />
            program &nbsp;<b>{caseData.lob.replace(/_/g, ' ')} PA</b>
            <br />
            urgency &nbsp;<b>{caseData.urgency}</b>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Events timeline helpers ───────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  case_created: 'Case created',
  transition: 'State transition',
  rfi_sent: 'RFI sent',
  rfi_response: 'RFI response received',
  escalated: 'Escalated to MD',
  human_signoff: 'Clinician sign-off recorded',
  determination_issued: 'Determination issued',
}

function nodeType(eventType: string): string {
  if (eventType === 'case_created') return 'sys'
  if (
    eventType === 'human_signoff' ||
    eventType === 'determination_issued'
  )
    return ''
  return 'sys'
}

// ── WorkColumn ────────────────────────────────────────────────────────────────

function WorkColumn({
  caseData,
  caseId,
  onDecisionComplete,
}: {
  caseData: CaseDetail
  caseId: string
  onDecisionComplete: () => void
}) {
  const [openCrit, setOpenCrit] = useState<Set<number>>(new Set())
  const events = caseData.events as Record<string, unknown>[]
  const isClinicReview = caseData.status === 'clinical_review'

  const { data: criteria, isLoading: criteriaLoading } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId),
    staleTime: 30_000,
  })
  const criteriaItems = criteria ?? []

  function toggleCrit(idx: number) {
    setOpenCrit((prev) => {
      const s = new Set(prev)
      if (s.has(idx)) s.delete(idx)
      else s.add(idx)
      return s
    })
  }

  return (
    <section className="en-col work">
      <div className="en-work-head">
        <h2>Criteria review</h2>
        <span className="en-policy-pin">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          Plan policy · <b>pinned at decision time</b>
        </span>
      </div>

      {/* Gap bar — only when in clinical review */}
      {isClinicReview && (
        <div className="en-gapbar">
          <svg
            className="gi"
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M8 2L14 13H2L8 2z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <line
              x1="8"
              y1="7"
              x2="8"
              y2="9.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11.5" r=".7" fill="currentColor" />
          </svg>
          <div>
            <div className="gt">Criteria review pending</div>
            <div className="gs">
              Complete clinical assessment before determining
            </div>
          </div>
        </div>
      )}

      {/* Criteria accordion cards */}
      {criteriaLoading && (
        <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '12px 0' }}>
          Loading criteria…
        </div>
      )}
      {!criteriaLoading && criteriaItems.length === 0 && (
        <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '12px 0' }}>
          No criteria data yet.
        </div>
      )}
      {criteriaItems.map((c: CriterionItem, idx: number) => {
        const isOpen = openCrit.has(idx)
        return (
          <div key={c.id} className={`en-crit${isOpen ? ' open' : ''}`}>
            <button
              className="en-crit-h"
              onClick={() => toggleCrit(idx)}
              aria-expanded={isOpen}
            >
              <span className={`en-stat-ic ${c.status}`}>
                {c.status === 'met' ? (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 8.5l2.5 2.5L12 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 5v4M8 11v.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cnum">{c.criterion_id}</div>
                <div className="ctext">{c.text}</div>
              </div>
              <span className={`cstat ${c.status}`}>
                {c.status === 'met' ? 'Met' : 'Gap'}
              </span>
              <svg
                className="chev"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="en-crit-b">
              <p style={{ marginBottom: 8 }}>{c.text}</p>
              {c.status === 'met' && c.evidence && (
                <div className="en-ev-link">
                  <svg
                    className="el-ic"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M4 2h8l3 3v9H4V2z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 2v4h4"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div>
                    <div className="el-t">{c.evidence.title}</div>
                    <div className="el-m">{c.evidence.meta}</div>
                  </div>
                  <span className="el-go">View →</span>
                </div>
              )}
              {c.status === 'gap' && c.citations.length > 0 && (
                <div className="en-gap-note">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 2L14 13H2L8 2z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                    <line
                      x1="8"
                      y1="7"
                      x2="8"
                      y2="9.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  {c.citations.join(' · ')}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Events timeline */}
      <div
        className="en-panel"
        data-testid="events-timeline"
        style={{ marginTop: 22 }}
      >
        <div className="en-panel-h">
          <span className="pt">Case timeline</span>
          <span className="lbl">
            {events.length} event{events.length !== 1 ? 's' : ''} · immutable
          </span>
        </div>
        <div className="en-panel-b" style={{ paddingBottom: 8 }}>
          {events.length === 0 ? (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
              No events yet.
            </p>
          ) : (
            events.map((ev, i) => {
              const evType =
                typeof ev.event_type === 'string' ? ev.event_type : 'unknown'
              const label =
                EVENT_TYPE_LABELS[evType] ?? evType.replace(/_/g, ' ')
              const toState =
                typeof ev.to_state === 'string'
                  ? ev.to_state.replace(/_/g, ' ')
                  : null
              const ts =
                typeof ev.occurred_at === 'string'
                  ? new Date(ev.occurred_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''
              const nt = nodeType(evType)
              return (
                <div key={i} className="en-tl-ev">
                  <span className={`en-tl-node${nt ? ` ${nt}` : ''}`} />
                  <div>
                    <div className="te">
                      {label}
                      {toState ? ` → ${toState}` : ''}
                    </div>
                    {ts && <div className="tts">{ts}</div>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Decision form */}
      <DecisionForm caseId={caseId} onComplete={onDecisionComplete} />
    </section>
  )
}

// ── AI advisory column ────────────────────────────────────────────────────────

function AiColumn({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient()

  const { data: suggestions, isLoading: sugsLoading } = useQuery({
    queryKey: ['suggestions', caseId],
    queryFn: () => getSuggestions(caseId),
    staleTime: 30_000,
  })

  const { mutate: recordAction, variables: pendingAction } = useMutation({
    mutationFn: ({ sid, action }: { sid: string; action: 'accepted' | 'rejected' }) =>
      postSuggestionAction(caseId, sid, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestions', caseId] })
    },
  })

  const sugItems = suggestions ?? []

  return (
    <aside className="en-col ai" aria-label="Governed AI advisory">
      <div className="en-ai-card">
        <div className="en-ai-card-h">
          <span className="at">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle
                cx="8"
                cy="8"
                r="6.4"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M8 5v3l2 1.2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            Governed AI · Advisory
          </span>
          <span className="en-advisory-chip">Advisory only</span>
        </div>
        <div className="en-ai-card-b">
          <p className="en-ai-sum">
            Patient meets 2 of 3 imaging criteria (InterQual 2025).
            Documentation gap: ordering physician attestation missing (C-02).
            Recommend requesting attestation before advancing to determination.
          </p>

          {/* Citation chips */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginTop: 10,
            }}
          >
            {['Policy §4.2.1', 'InterQual 2025', 'Notes 2024-11'].map((c) => (
              <span
                key={c}
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '2px 7px',
                  color: 'var(--ink-mut)',
                }}
              >
                {c}
              </span>
            ))}
          </div>

          {/* Suggestions */}
          <div className="en-ai-sug">
            {sugsLoading && (
              <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '8px 0' }}>
                Loading suggestions…
              </div>
            )}
            {!sugsLoading && sugItems.length === 0 && (
              <div style={{ color: 'var(--ink-mut)', fontSize: 13, padding: '8px 0' }}>
                No suggestions yet.
              </div>
            )}
            {sugItems.map((s: SuggestionItem) => {
              const isDone = s.status !== 'pending' || pendingAction?.sid === s.id
              return (
                <div key={s.id} className={`en-sg${isDone ? ' done' : ''}`}>
                  <span className="sgi">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 2L14 13H2L8 2z"
                        stroke="var(--amber)"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <line
                        x1="8"
                        y1="7"
                        x2="8"
                        y2="9.5"
                        stroke="var(--amber)"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                      <circle cx="8" cy="11.5" r=".7" fill="var(--amber)" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sgt">{s.title}</div>
                    <div className="sgm">{s.body}</div>
                    <div className="conf">
                      Confidence {(s.confidence * 100).toFixed(0)}%
                      {s.citations.length > 0 ? ` · ${s.citations.join(', ')}` : ''}
                    </div>
                    <div className="en-sg-acts">
                      <button
                        className="go"
                        disabled={isDone}
                        onClick={() => recordAction({ sid: s.id, action: 'accepted' })}
                      >
                        Accept
                      </button>
                      <button
                        disabled={isDone}
                        onClick={() => recordAction({ sid: s.id, action: 'rejected' })}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="en-ai-foot">
          <span className="en-boundary">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect
                x="3"
                y="7"
                width="10"
                height="6.5"
                rx="1.4"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M5.5 7V5a2.5 2.5 0 015 0v2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            Cannot issue a determination
          </span>
        </div>
      </div>
    </aside>
  )
}

// ── MD view: context column ───────────────────────────────────────────────────

function MdContextColumn({ caseData }: { caseData: CaseDetail }) {
  const m = caseData.member as Record<string, unknown>
  const c = caseData.coverage as Record<string, unknown>
  const name = memberName(m)
  const dob = typeof m.date_of_birth === 'string' ? m.date_of_birth : '—'
  const mrn = typeof m.mrn === 'string' ? m.mrn : '—'
  const payer = typeof c.payer_name === 'string' ? c.payer_name : '—'
  const plan = typeof c.plan_id === 'string' ? c.plan_id : '—'
  const lob =
    typeof c.lob === 'string' ? c.lob.replace(/_/g, ' ') : caseData.lob

  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['documents', caseData.case_id],
    queryFn: () => getCaseDocuments(caseData.case_id),
  })

  return (
    <section className="en-col ctx">
      {/* Escalation panel */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Escalation</span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 9,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--amber)',
              background: 'var(--amber-tint)',
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            MD review
          </span>
        </div>
        <div className="en-panel-b">
          <div className="en-escal">
            <div className="et">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"
                  stroke="var(--amber)"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              Escalated for MD determination
            </div>
            <div className="en">
              Patient meets imaging criteria but lacks required physician
              attestation (C-02). Escalated per plan policy §4.2.1.
            </div>
          </div>
        </div>
      </div>

      {/* Member & coverage */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Member &amp; coverage</span>
        </div>
        <div className="en-panel-b">
          <div className="en-kv">
            <span className="k">Name</span>
            <span className="v">{name}</span>
          </div>
          <div className="en-kv">
            <span className="k">DOB</span>
            <span className="v">{dob}</span>
          </div>
          <div className="en-kv">
            <span className="k">MRN</span>
            <span
              className="v"
              style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}
            >
              {mrn}
            </span>
          </div>
          <div className="en-kv">
            <span className="k">Payer</span>
            <span className="v">{payer}</span>
          </div>
          <div className="en-kv">
            <span className="k">Plan</span>
            <span className="v">{plan}</span>
          </div>
          <div className="en-kv">
            <span className="k">LOB</span>
            <span className="v">{lob}</span>
          </div>
          <div className="en-kv">
            <span className="k">Eligibility</span>
            <span className="v">
              <span className="en-pillbadge">Active</span>
            </span>
          </div>
        </div>
      </div>

      {/* Service lines */}
      <div className="en-panel" data-testid="service-lines-panel">
        <div className="en-panel-h">
          <span className="pt">Requested service</span>
          <span className="lbl">
            {caseData.service_lines.length} line
            {caseData.service_lines.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="en-panel-b">
          {caseData.service_lines.length === 0 ? (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
              No service lines.
            </p>
          ) : (
            caseData.service_lines.map((sl, i) => {
              const code =
                typeof sl.procedure_code === 'string'
                  ? sl.procedure_code
                  : '—'
              const desc =
                typeof sl.procedure_description === 'string'
                  ? sl.procedure_description
                  : '—'
              const dx = Array.isArray(sl.diagnosis_codes)
                ? (sl.diagnosis_codes as string[]).join(', ')
                : '—'
              return (
                <div key={i} className="en-svcline">
                  <span className="code">{code}</span>
                  <div className="name">{desc}</div>
                  <div className="meta">
                    Dx: {dx} · {caseData.urgency} ·{' '}
                    {caseData.lob.replace(/_/g, ' ')}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Supporting documents */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Supporting documents</span>
          {documents.length > 0 && (
            <span className="lbl">{documents.length} docs</span>
          )}
        </div>
        <div className="en-panel-b">
          {docsLoading && (
            <p className="text-sm text-gray-500">Loading documents…</p>
          )}
          {!docsLoading && documents.length === 0 && (
            <p className="text-sm text-gray-400">No documents attached.</p>
          )}
          {documents.map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-blue-600 hover:underline truncate"
            >
              {doc.title}
              {doc.authored && (
                <span className="text-gray-400 ml-1">({doc.authored.slice(0, 10)})</span>
              )}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── MD view: work column ──────────────────────────────────────────────────────

const DET_TYPES: { key: AdverseOutcome; tn: string; td: string }[] = [
  {
    key: 'denied',
    tn: 'Deny',
    td: 'Not medically necessary per criteria',
  },
  {
    key: 'partially_denied',
    tn: 'Partial Denial',
    td: 'Approve some lines, deny others',
  },
  {
    key: 'adverse_modification',
    tn: 'Modification',
    td: 'Alternative service or setting',
  },
]

function MdWorkColumn({
  caseData,
  caseId,
  mdType,
  setMdType,
  decisionDone,
  onDecisionComplete,
}: {
  caseData: CaseDetail
  caseId: string
  mdType: AdverseOutcome
  setMdType: (t: AdverseOutcome) => void
  decisionDone: boolean
  onDecisionComplete: () => void
}) {
  const events = caseData.events as Record<string, unknown>[]

  return (
    <section className="en-col work">
      <div className="en-work-head">
        <h2>Adverse determination</h2>
        <div
          style={{
            marginTop: 6,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            color: 'var(--ink-mut)',
          }}
        >
          Case {shortId(caseData.case_id)} · MD sign-off required
        </div>
      </div>

      {/* Section 1: Determination type */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">1</span>
          <span className="st">Determination type</span>
          <span className="req done">Selected</span>
        </div>
        <div className="en-sec-b">
          <div className="en-types">
            {DET_TYPES.map((t) => (
              <button
                key={t.key}
                className={`en-type${mdType === t.key ? ' sel' : ''}`}
                onClick={() => setMdType(t.key)}
              >
                <div className="tn">{t.tn}</div>
                <div className="td">{t.td}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Section 2: Criteria review */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">2</span>
          <span className="st">Criteria review</span>
          <span className="req" style={{ color: 'var(--amber)', background: 'var(--amber-tint)' }}>
            1 gap
          </span>
        </div>
        <div className="en-sec-b">
          {/* Gap finding */}
          <div className="en-finding">
            <div className="en-finding-h">
              <div className="fic">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 5v4M8 11v.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="ft">C-02: Medical necessity attestation</div>
              <div className="fc">Gap</div>
            </div>
            <div className="en-finding-b">
              <div className="fl">
                Ordering physician attestation missing per plan policy §4.2.1
                and InterQual 2025 §3.4.1.
              </div>
              <div className="en-chips">
                <span className="en-chip-on">Policy §4.2.1</span>
                <span className="en-chip-on">InterQual 2025 §3.4.1</span>
              </div>
            </div>
          </div>
          {/* Met criteria */}
          <div className="en-met-row">
            <svg
              className="mi"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="6.4"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5 8.5l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            C-01: Imaging modality appropriate — Met
          </div>
          <div className="en-met-row">
            <svg
              className="mi"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="6.4"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M5 8.5l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            C-03: Conservative treatment documented — Met
          </div>
        </div>
      </div>

      {/* Section 3: Escalation context / rationale context */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">3</span>
          <span className="st">Clinical context</span>
        </div>
        <div className="en-sec-b">
          <div className="en-escal">
            <div className="et">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"
                  stroke="var(--amber)"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              Escalated by nurse reviewer
            </div>
            <div className="en">
              Patient meets imaging criteria but lacks required physician
              attestation (C-02). Escalated for MD determination on medical
              necessity grounds per plan policy §4.2.1.
            </div>
          </div>

          {/* Events timeline in MD view */}
          <div
            className="en-panel"
            data-testid="events-timeline"
            style={{ margin: 0 }}
          >
            <div className="en-panel-h">
              <span className="pt">Case timeline</span>
              <span className="lbl">
                {events.length} event{events.length !== 1 ? 's' : ''} · immutable
              </span>
            </div>
            <div className="en-panel-b" style={{ paddingBottom: 8 }}>
              {events.length === 0 ? (
                <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
                  No events yet.
                </p>
              ) : (
                events.map((ev, i) => {
                  const evType =
                    typeof ev.event_type === 'string'
                      ? ev.event_type
                      : 'unknown'
                  const label =
                    EVENT_TYPE_LABELS[evType] ?? evType.replace(/_/g, ' ')
                  const toState =
                    typeof ev.to_state === 'string'
                      ? ev.to_state.replace(/_/g, ' ')
                      : null
                  const ts =
                    typeof ev.occurred_at === 'string'
                      ? new Date(ev.occurred_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''
                  const nt = nodeType(evType)
                  return (
                    <div key={i} className="en-tl-ev">
                      <span
                        className={`en-tl-node${nt ? ` ${nt}` : ''}`}
                      />
                      <div>
                        <div className="te">
                          {label}
                          {toState ? ` → ${toState}` : ''}
                        </div>
                        {ts && <div className="tts">{ts}</div>}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Structured adverse sign-off */}
      <div className="en-det-section">
        <div className="en-sec-h">
          <span className="sn">4</span>
          <span className="st">Findings, codes &amp; sign-off</span>
          {decisionDone ? (
            <span className="req done" data-testid="md-adverse-complete">Complete</span>
          ) : (
            <span className="req">Required</span>
          )}
        </div>
        {!decisionDone && (
          <div className="en-sec-b">
            <MdAdverseForm
              caseId={caseId}
              determinationType={mdType}
              onComplete={onDecisionComplete}
            />
          </div>
        )}
      </div>

      {/* Issued banner — shown after determination recorded */}
      {decisionDone && (
        <div className="en-issued-banner">
          <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#EAF4F1" strokeWidth="1.4" />
            <path
              d="M5 8.5l2 2 4-4"
              stroke="#EAF4F1"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <div className="ib-t">Determination recorded</div>
            <div className="ib-s">
              Recorded with full provenance and clinician attestation.
              The case timeline has been updated.
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ── MD view: gate column ──────────────────────────────────────────────────────

function GateColumn({
  decisionDone,
}: {
  decisionDone: boolean
}) {
  const gateItems = [
    { label: 'Determination type selected', done: true },
    { label: 'Criteria reviewed', done: true },
    { label: 'Gap criteria documented', done: true },
    { label: 'Citations added', done: true },
    { label: 'Clinical rationale complete', done: decisionDone },
    { label: 'Clinician sign-off', done: decisionDone },
  ]
  const doneCount = gateItems.filter((i) => i.done).length
  const total = gateItems.length
  const ready = doneCount === total
  const pct = Math.round((doneCount / total) * 100)

  return (
    <aside className="en-col gate">
      <div className="en-gate-card">
        <div className="en-gate-h">
          <div className="gt">Sign-off readiness</div>
          <div className="gs">
            Complete all steps before issuing the determination
          </div>
          <div className="en-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div
            style={{
              marginTop: 7,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              color: 'var(--ink-mut)',
            }}
          >
            {doneCount} / {total} complete
          </div>
        </div>
        <div className="en-gate-b">
          {gateItems.map((item, i) => (
            <div key={i} className={`en-chk${item.done ? ' done' : ''}`}>
              <span className="box">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 8.5l2.5 2.5L12 5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="ct">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="en-gate-f">
          <button className="en-preview-btn">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle
                cx="8"
                cy="8"
                r="2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            Preview notice letter
          </button>
          <button
            className={`en-issue-btn${ready ? ' ready' : ''}`}
            disabled={!ready}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M5.5 8l2 2 3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {ready ? 'Issue determination' : 'Complete steps to issue'}
          </button>
        </div>
      </div>
    </aside>
  )
}

// ── RFI Modal ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'lab', label: 'Lab results' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'clinical_notes', label: 'Clinical notes' },
  { value: 'referral', label: 'Referral' },
] as const

function RfiModal({
  caseId,
  onClose,
  onSuccess,
}: {
  caseId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [question, setQuestion] = useState('')
  const [requestedDocs, setRequestedDocs] = useState<string[]>([])

  const mutation = useMutation({
    mutationFn: () =>
      postRfi(caseId, { question, requested_docs: requestedDocs }),
    onSuccess,
  })

  const toggleDoc = (value: string) =>
    setRequestedDocs((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value],
    )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          Request information from provider
        </h3>

        <textarea
          className="w-full border rounded p-2 text-sm resize-none"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Describe what information is needed…"
          rows={4}
        />

        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-gray-700 mb-1">
            Document types requested
          </legend>
          <div className="space-y-1">
            {DOC_TYPES.map((dt) => (
              <label key={dt.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requestedDocs.includes(dt.value)}
                  onChange={() => toggleDoc(dt.value)}
                />
                {dt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {mutation.isError && (
          <p className="mt-2 text-sm text-red-600">
            Failed to send — please try again.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={() => mutation.mutate()}
            disabled={!question.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CasePage() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [decisionDone, setDecisionDone] = useState(false)
  const [mdType, setMdType] = useState<AdverseOutcome>('denied')
  const [rfiOpen, setRfiOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
  })

  const secsRemaining = useSlaCountdown(data?.sla ?? null)

  if (!caseId) return <p>No case ID.</p>

  if (isLoading) {
    return (
      <div className="en-app">
        <Topbar status="clinical_review" />
        <div style={{ padding: 40, color: 'var(--ink-mut)' }}>
          Loading case…
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="en-app">
        <Topbar status="clinical_review" />
        <div style={{ padding: 40 }}>
          <p role="alert" style={{ color: 'var(--red)', marginBottom: 12 }}>
            {(error as Error)?.message ?? 'Failed to load case'}
          </p>
          <button
            className="en-act"
            onClick={() => navigate('/queues/default/worklist')}
          >
            ← Back to worklist
          </button>
        </div>
      </div>
    )
  }

  const name = memberName(data.member as Record<string, unknown>)
  const clsSla = slaClass(data.sla)
  const urgencyLabel =
    data.urgency.charAt(0).toUpperCase() + data.urgency.slice(1)
  const stateLabel = STATUS_LABEL[data.status] ?? data.status.replace(/_/g, ' ')
  const stCls = statusCls(data.status)
  const isMdReview = data.status === 'md_review'

  const firstLine = data.service_lines[0] as Record<string, unknown> | undefined
  const serviceDesc = firstLine
    ? typeof firstLine.procedure_description === 'string'
      ? firstLine.procedure_description
      : ''
    : ''

  return (
    <div className="en-app">
      <Topbar status={data.status} />

      <div className="en-body">
        <WorklistRail currentCaseId={caseId} collapsed={railCollapsed} />

        <main className="en-case">
          {/* ── Command bar ───────────────────────────────────────────── */}
          <div className="en-cmd" data-testid="case-header">
            <button
              className="en-railtoggle"
              title="Toggle queue"
              aria-label="Toggle queue"
              onClick={() => setRailCollapsed((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="en-cmd-id">
              <div className="top">
                <span className="cid">{shortId(caseId)}</span>
                <span className="en-pri">{urgencyLabel}</span>
                <span
                  className={`en-state${stCls ? ` ${stCls}` : ''}`}
                >
                  {stateLabel}
                </span>
              </div>
              <div className="sub">
                {serviceDesc && <>{serviceDesc} &nbsp;·&nbsp; </>}
                <b>{name}</b>
                {data.lob && (
                  <> &nbsp;·&nbsp; {data.lob.replace(/_/g, ' ')}</>
                )}
              </div>
            </div>

            {data.sla && (
              <div className="en-clock-box">
                <span className="lbl2">Decision due in</span>
                <span className={`en-clock-val ${clsSla}`}>
                  <span className="num">
                    {data.sla.paused ? '—' : formatCountdown(secsRemaining)}
                  </span>
                  <span className="stat">
                    {data.sla.paused ? 'Paused' : 'Running'}
                  </span>
                </span>
              </div>
            )}

            <div className="en-actions">
              {/* Timeline icon */}
              <button
                className="en-iconbtn"
                title="Case timeline"
                aria-label="Case timeline"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M8 5v3l2 1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {/* Request info — primary */}
              {!decisionDone && !isMdReview && (
                <button
                  className="en-act primary"
                  onClick={() => setRfiOpen(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 2v8M8 12v.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="8"
                      cy="8"
                      r="6.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                  </svg>
                  Request info
                </button>
              )}

              {rfiOpen && (
                <RfiModal
                  caseId={caseId!}
                  onClose={() => setRfiOpen(false)}
                  onSuccess={() => {
                    setRfiOpen(false)
                    queryClient.invalidateQueries({ queryKey: ['case', caseId] })
                    queryClient.invalidateQueries({ queryKey: ['worklist'] })
                  }}
                />
              )}

              {/* Back to worklist */}
              <button
                className="en-act"
                style={{ fontSize: 12, padding: '7px 11px' }}
                onClick={() => navigate('/queues/default/worklist')}
              >
                ← Worklist
              </button>

              {!decisionDone && (
                <button
                  className="en-act"
                  style={{ fontSize: 12, padding: '7px 11px' }}
                  onClick={() => refetch()}
                >
                  Refresh
                </button>
              )}
            </div>
          </div>

          {/* ── Three-column content ───────────────────────────────────── */}
          {isMdReview ? (
            <div className="en-content md-view">
              <MdContextColumn caseData={data} />
              <MdWorkColumn
                caseData={data}
                caseId={caseId}
                mdType={mdType}
                setMdType={setMdType}
                decisionDone={decisionDone}
                onDecisionComplete={() => setDecisionDone(true)}
              />
              <GateColumn decisionDone={decisionDone} />
            </div>
          ) : (
            <div className="en-content">
              <ContextColumn caseData={data} />
              <WorkColumn
                caseData={data}
                caseId={caseId}
                onDecisionComplete={() => setDecisionDone(true)}
              />
              <AiColumn caseId={caseId} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
