import { useState, useEffect, useRef, useCallback } from 'react'
import type { RefObject } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCase, getCaseDocuments, getCriteria, getDocumentContent, getNoticePreview, getWorklist, postRfi, submitDecision, getWorkbenchCase } from '../api/client'
import type { WorkbenchCaseDetail } from '../api/client'
import type { AdverseOutcome, CaseDetail, CriterionItem, SlaInfo, WorklistItem } from '../types'
import { AppShell } from '../components/AppShell'
import { useAuth, hasRole } from '../auth/AuthContext'
import { DecisionForm } from '../components/DecisionForm'
import { MdAdverseForm, type MdFormReadiness } from '../components/MdAdverseForm'
import { AppealFilingModal } from '../components/AppealFilingModal'
import { GrievanceFilingModal } from '../components/GrievanceFilingModal'
import { CitedDocumentPanel, AiSummaryPanel } from '../components/workbenchComponents'

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
  if (status === 'md_review') return 'pending-info'
  if (status === 'approved') return 'approved'
  if (status === 'denied' || status === 'partially_denied') return 'denied'
  if (status === 'adverse_modification') return 'modified'
  if (status === 'pend_rfi' || status === 'completeness_check')
    return 'pending-info'
  return 'in-review'
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

function getCaseServiceDesc(cd?: CaseDetail | null): string {
  if (!cd) return ''
  if (cd.service_lines && cd.service_lines.length > 0) {
    const sl = cd.service_lines[0]
    if (typeof sl.procedure_description === 'string' && sl.procedure_description) {
      return sl.procedure_description
    }
  }
  return cd.lob ? cd.lob.replace(/_/g, ' ') : ''
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

// ── Timeline SlideOver ────────────────────────────────────────────────────────

function TimelineDrawer({
  events,
  open,
  onClose,
}: {
  events: Record<string, unknown>[]
  open: boolean
  onClose: () => void
}) {
  return (
    <>
      <div
        className={`en-tl-scrim${open ? ' on' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`en-tl-drawer${open ? ' on' : ''}`}
        aria-label="Case timeline"
        data-testid="events-timeline"
      >
        <div className="en-tl-drawer-h">
          <div>
            <div className="en-tl-drawer-title">Case timeline</div>
            <div className="en-tl-drawer-sub">
              Immutable · every action recorded
            </div>
          </div>
          <button
            className="en-iconbtn"
            onClick={onClose}
            aria-label="Close timeline"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="en-tl-drawer-list">
          {events.length === 0 && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
              No events yet.
            </p>
          )}
          {events.map((ev, i) => {
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
              <div key={typeof ev.id === 'string' ? ev.id : typeof ev.event_id === 'string' ? ev.event_id : `ev-${i}`} className="en-tl-ev">
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
          })}
        </div>
      </aside>
    </>
  )
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

// ── Document content modal ────────────────────────────────────────────────────

function DocumentModal({
  documentId,
  onClose,
}: {
  documentId: string
  onClose: () => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['doc-content', documentId],
    queryFn: () => getDocumentContent(documentId),
    staleTime: Infinity,
  })

  return (
    <div className="en-modal-scrim" onClick={onClose}>
      <div className="en-modal-card" onClick={e => e.stopPropagation()}>
        <div className="en-modal-h">
          <div className="en-modal-title">{data?.title ?? 'Document'}</div>
          <button className="en-iconbtn" onClick={onClose} aria-label="Close document">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="en-modal-b">
          {isLoading && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>Loading…</p>
          )}
          {isError && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>
              Failed to load document.
            </p>
          )}
          {data && (
            <pre
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                margin: 0,
                lineHeight: 1.7,
              }}
            >
              {data.body}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Context column ────────────────────────────────────────────────────────────

function ContextColumn({ caseData }: { caseData: CaseDetail }) {
  const [viewingDoc, setViewingDoc] = useState<string | null>(null)
  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['documents', caseData.case_id],
    queryFn: () => getCaseDocuments(caseData.case_id),
    staleTime: 60_000,
  })
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

      {/* Submitted documents */}
      <div className="en-panel">
        <div className="en-panel-h">
          <span className="pt">Submitted documents</span>
          {documents.length > 0 && (
            <span className="lbl">{documents.length} docs</span>
          )}
        </div>
        <div className="en-panel-b">
          {docsLoading && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>Loading…</p>
          )}
          {!docsLoading && documents.length === 0 && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>
              No documents attached.
            </p>
          )}
          {documents.map(doc => (
            <div key={doc.id} className="en-doc-row">
              <div>
                <div className="en-doc-name">{doc.title}</div>
                {doc.authored && (
                  <div className="en-doc-meta">{doc.authored.slice(0, 10)}</div>
                )}
              </div>
              <button
                className="en-doc-view"
                onClick={() => setViewingDoc(doc.id)}
                data-testid={`doc-view-${doc.id}`}
              >
                View →
              </button>
            </div>
          ))}
        </div>
      </div>

      {viewingDoc && (
        <DocumentModal
          documentId={viewingDoc}
          onClose={() => setViewingDoc(null)}
        />
      )}
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

// ── ReviewColumn ──────────────────────────────────────────────────────────────

function ReviewColumn({
  caseData,
  caseId,
  workbench,
  selectedCitationId,
  onSelectCitation,
  onDecisionComplete,
  onOpenRfi,
}: {
  caseData: CaseDetail
  caseId: string
  workbench: WorkbenchCaseDetail | undefined
  selectedCitationId: string | null
  onSelectCitation: (id: string) => void
  onDecisionComplete: () => void
  onOpenRfi: (initialQuestion?: string) => void
}) {
  const [openCrit, setOpenCrit] = useState<Set<number>>(new Set())
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
      {workbench && (
        <AiSummaryPanel
          summary={workbench.summary}
          groundedness={workbench.groundedness}
          completeness={workbench.completeness}
          onSelectCitation={onSelectCitation}
          className="flex flex-col p-5 space-y-5 mb-4 border border-slate-100 rounded-lg bg-blue-50/30"
        />
      )}
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
              {c.status === 'gap' && (
                <button
                  className="en-mini-rfi"
                  data-testid={`rfi-crit-${c.id}`}
                  onClick={() =>
                    onOpenRfi(`Please provide documentation for: ${c.text}`)
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 4h10v7H6l-3 2z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Request this documentation
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Decision form */}
      <DecisionForm caseId={caseId} onComplete={onDecisionComplete} />
    </section>
  )
}

// ── Notice preview modal ──────────────────────────────────────────────────────

function NoticePreviewModal({
  caseId,
  onClose,
}: {
  caseId: string
  onClose: () => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notice-preview', caseId],
    queryFn: () => getNoticePreview(caseId),
    staleTime: Infinity,
  })

  return (
    <div className="en-modal-scrim" onClick={onClose}>
      <div className="en-modal-card" onClick={e => e.stopPropagation()}>
        <div className="en-modal-h">
          <div>
            <div className="en-modal-title">Notice of adverse determination</div>
            <div className="en-modal-sub">Draft preview · not yet issued</div>
          </div>
          <button
            className="en-iconbtn"
            onClick={onClose}
            aria-label="Close notice preview"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="en-modal-b">
          {isLoading && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>Loading…</p>
          )}
          {isError && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>
              Failed to load preview.
            </p>
          )}
          {data && (
            <pre
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                margin: 0,
                lineHeight: 1.7,
              }}
              data-testid="notice-preview-body"
            >
              {data.body}
            </pre>
          )}
        </div>
        <div className="en-modal-f">
          <button className="en-act" onClick={onClose} data-testid="btn-close-notice-preview">
            Close
          </button>
        </div>
      </div>
    </div>
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
              {getCaseServiceDesc(caseData)
                ? `Case for ${getCaseServiceDesc(caseData)} escalated for Medical Director determination on medical necessity criteria per plan policy §4.2.`
                : 'Case escalated for Medical Director determination per plan policy §4.2.'}
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
  onReadinessChange,
  submitRef,
  criteria,
}: {
  caseData: CaseDetail
  caseId: string
  mdType: AdverseOutcome
  setMdType: (t: AdverseOutcome) => void
  decisionDone: boolean
  onDecisionComplete: () => void
  onReadinessChange: (state: MdFormReadiness) => void
  submitRef: RefObject<{ submit: () => void } | null>
  criteria: CriterionItem[]
}) {
  const navigate = useNavigate()
  const auth = useAuth()
  const [appealFilingOpen, setAppealFilingOpen] = useState(false)
  const [grievanceFilingOpen, setGrievanceFilingOpen] = useState(false)

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
          {criteria.filter(c => c.status === 'gap').length > 0 && (
            <span className="req" style={{ color: 'var(--amber)', background: 'var(--amber-tint)' }}>
              {criteria.filter(c => c.status === 'gap').length} gap
            </span>
          )}
        </div>
        <div className="en-sec-b">
          {criteria.length === 0 && (
            <p style={{ color: 'var(--ink-mut)', fontSize: 13 }}>Loading criteria…</p>
          )}
          {criteria.map(c => (
            <div key={c.id} className={`en-crit-row ${c.status}`}>
              <span className="en-crit-icon">
                {c.status === 'met' ? '✓' : c.status === 'gap' ? '⚠' : '?'}
              </span>
              <div>
                <div className="en-crit-text">
                  {c.criterion_id}: {c.text}
                </div>
                {c.status === 'gap' && (
                  <div className="en-crit-gap-note">Being addressed in determination</div>
                )}
              </div>
            </div>
          ))}
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
              {getCaseServiceDesc(caseData)
                ? `Case for ${getCaseServiceDesc(caseData)} escalated for MD determination on medical necessity grounds per plan policy §4.2.`
                : 'Escalated for MD determination on medical necessity grounds per plan policy §4.2.'}
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
              onReadinessChange={onReadinessChange}
              submitRef={submitRef}
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
          {hasRole(auth, 'appeals_coordinator') && (
            <button
              className="en-act"
              style={{ marginLeft: 12 }}
              onClick={() => setAppealFilingOpen(true)}
              data-testid="btn-file-appeal-from-case"
            >
              File appeal
            </button>
          )}
          {hasRole(auth, 'grievance_coordinator') && (
            <button
              className="en-btn en-btn--secondary"
              data-testid="btn-file-grievance-from-case"
              onClick={() => setGrievanceFilingOpen(true)}
            >
              File grievance
            </button>
          )}
        </div>
      )}
      {appealFilingOpen && caseId && (
        <AppealFilingModal
          caseId={caseId}
          onClose={() => setAppealFilingOpen(false)}
          onFiled={(cid, aid) => {
            setAppealFilingOpen(false)
            navigate(`/cases/${cid}/appeals/${aid}`)
          }}
        />
      )}
      {grievanceFilingOpen && caseId && (
        <GrievanceFilingModal
          caseId={caseId}
          onClose={() => setGrievanceFilingOpen(false)}
          onFiled={(grievanceId) => {
            setGrievanceFilingOpen(false)
            navigate(`/grievances/${grievanceId}`)
          }}
        />
      )}
    </section>
  )
}

// ── MD view: gate column ──────────────────────────────────────────────────────

function GateColumn({
  decisionDone,
  mdFormState,
  ready,
  onIssue,
  onPreviewNotice,
}: {
  decisionDone: boolean
  mdFormState: MdFormReadiness
  ready: boolean
  onIssue: () => void
  onPreviewNotice: () => void
}) {
  const gateItems = [
    { label: 'Determination type selected', done: true },
    { label: 'Criteria reviewed', done: mdFormState.criteriaLoaded },
    { label: 'Gap criteria documented', done: mdFormState.hasFindings },
    { label: 'Citations added', done: mdFormState.citations },
    { label: 'Clinical rationale complete', done: mdFormState.rationale },
    { label: 'Clinician sign-off', done: mdFormState.clinicianId && mdFormState.confirmed },
  ]
  const doneCount = gateItems.filter((i) => i.done).length
  const total = gateItems.length
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
          <button
            className="en-preview-btn"
            onClick={onPreviewNotice}
            data-testid="btn-preview-notice"
          >
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
            disabled={!ready || decisionDone}
            onClick={onIssue}
            data-testid="btn-issue-determination"
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
  initialQuestion = '',
}: {
  caseId: string
  onClose: () => void
  onSuccess: () => void
  initialQuestion?: string
}) {
  const [question, setQuestion] = useState(initialQuestion)
  const [requestedDocs, setRequestedDocs] = useState<string[]>([])

  const mutation = useMutation({
    mutationFn: () =>
      postRfi(caseId, { question, requested_docs: requestedDocs }),
    onSuccess,
  })

  const toggleDoc = (value: string) =>
    setRequestedDocs(prev =>
      prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value],
    )

  return (
    <div className="en-modal-scrim" onClick={onClose}>
      <div className="en-modal-card" onClick={e => e.stopPropagation()}>
        <div className="en-modal-h">
          <div>
            <div className="en-modal-title">Request additional information</div>
            <div className="en-modal-sub">Sent to provider via portal &amp; FHIR</div>
          </div>
        </div>
        <div className="en-modal-b">
          <label className="en-modal-label" htmlFor="rfi-question">
            Request
          </label>
          <textarea
            id="rfi-question"
            className="en-textarea"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Describe what information is needed…"
            rows={4}
          />
          <fieldset style={{ border: 0, margin: '12px 0 0', padding: 0 }}>
            <legend className="en-modal-label">Document types requested</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DOC_TYPES.map(dt => (
                <label
                  key={dt.value}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
                >
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
          <div className="en-pausebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 5v6M10 5v6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            Sending this pauses the decision clock until a response is received.
          </div>
          {mutation.isError && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>
              Failed to send — please try again.
            </p>
          )}
        </div>
        <div className="en-modal-f">
          <button
            className="en-act"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            className="en-act primary"
            onClick={() => mutation.mutate()}
            disabled={!question.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Sending…' : 'Send RFI & pause clock'}
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
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [rfiInitialQuestion, setRfiInitialQuestion] = useState('')
  const [mdFormState, setMdFormState] = useState<MdFormReadiness>({
    criteriaLoaded: false,
    hasFindings: false,
    citations: false,
    rationale: false,
    clinicianId: false,
    confirmed: false,
  })
  const [noticePreviewOpen, setNoticePreviewOpen] = useState(false)
  const mdSubmitRef = useRef<{ submit: () => void } | null>(null)

  const handleMdReadinessChange = useCallback((state: MdFormReadiness) => {
    setMdFormState(state)
  }, [])

  const mdFormReady =
    mdFormState.hasFindings &&
    mdFormState.citations &&
    mdFormState.rationale &&
    mdFormState.clinicianId &&
    mdFormState.confirmed

  const referToMdMutation = useMutation({
    mutationFn: () => submitDecision(caseId!, 'escalate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] })
    },
  })

  const auth = useAuth()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
    staleTime: 30_000,
  })

  const { data: mdCriteria = [] } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId!),
    staleTime: 60_000,
    enabled: !!caseId,
  })

  const { data: workbench } = useQuery({
    queryKey: ['workbench', caseId],
    queryFn: () => getWorkbenchCase(caseId!),
    enabled: !!caseId,
    staleTime: 60_000,
    retry: 1,
  })

  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null)

  const secsRemaining = useSlaCountdown(data?.sla ?? null)

  if (!caseId) return <p>No case ID.</p>

  if (isLoading) {
    return (
      <AppShell noScroll breadcrumb={<b>Clinical Review</b>}>
        <div className="en-body">
          <div style={{ padding: 40, color: 'var(--ink-mut)' }}>Loading case…</div>
        </div>
      </AppShell>
    )
  }

  if (isError || !data) {
    return (
      <AppShell noScroll breadcrumb={<b>Clinical Review</b>}>
        <div className="en-body">
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
      </AppShell>
    )
  }

  const name = memberName(data.member as Record<string, unknown>)
  const clsSla = slaClass(data.sla)
  const urgencyLabel =
    data.urgency.charAt(0).toUpperCase() + data.urgency.slice(1)
  const stateLabel = STATUS_LABEL[data.status] ?? data.status.replace(/_/g, ' ')
  const stCls = statusCls(data.status)
  const canViewAsNurse = hasRole(auth, 'clinical-reviewer') && data.status === 'clinical_review'
  const canViewAsMd = hasRole(auth, 'medical_director') && data.status === 'md_review'
  const isMdReview = canViewAsMd

  if (!canViewAsNurse && !canViewAsMd) {
    return (
      <AppShell noScroll breadcrumb={<b>Clinical Review</b>}>
        <div className="en-body">
          <div style={{ padding: 40 }}>
            <p style={{ color: 'var(--ink-mut)', marginBottom: 12, fontSize: 14 }}>
              This case is not assigned to your role in its current state.
            </p>
            <button
              className="en-act"
              onClick={() => navigate('/queues/default/worklist')}
            >
              ← Back to worklist
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  const firstLine = data.service_lines[0] as Record<string, unknown> | undefined
  const serviceDesc = firstLine
    ? typeof firstLine.procedure_description === 'string'
      ? firstLine.procedure_description
      : ''
    : ''

  return (
    <AppShell
      noScroll
      breadcrumb={
        <>
          Utilization Mgmt &nbsp;/&nbsp; Clinical Review &nbsp;/&nbsp;{' '}
          <b>{isMdReview ? 'Determination' : 'Review'}</b>
        </>
      }
    >
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
                <span className="en-pri-badge std">{urgencyLabel}</span>
                <span className={`en-state-chip ${stCls}`}>{stateLabel}</span>
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
                onClick={() => setTimelineOpen(true)}
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

              {!decisionDone && !isMdReview && (
                <button
                  className="en-act"
                  data-testid="btn-refer-md"
                  onClick={() => referToMdMutation.mutate()}
                  disabled={referToMdMutation.isPending}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {referToMdMutation.isPending ? 'Referring…' : 'Refer to MD'}
                </button>
              )}

              {rfiOpen && (
                <RfiModal
                  caseId={caseId!}
                  initialQuestion={rfiInitialQuestion}
                  onClose={() => { setRfiOpen(false); setRfiInitialQuestion('') }}
                  onSuccess={() => {
                    setRfiOpen(false)
                    setRfiInitialQuestion('')
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
                onReadinessChange={handleMdReadinessChange}
                submitRef={mdSubmitRef}
                criteria={mdCriteria}
              />
              <GateColumn
                decisionDone={decisionDone}
                mdFormState={mdFormState}
                ready={mdFormReady}
                onIssue={() => mdSubmitRef.current?.submit()}
                onPreviewNotice={() => setNoticePreviewOpen(true)}
              />
            </div>
          ) : (
            <div className="en-content">
              <ContextColumn caseData={data} />
              <section className="en-col doc">
                <CitedDocumentPanel
                  caseId={caseId}
                  documentUrl={workbench?.documentUrl ?? null}
                  citations={workbench?.citations ?? []}
                  selectedCitationId={selectedCitationId ?? undefined}
                  onSelectCitation={setSelectedCitationId}
                />
              </section>
              <ReviewColumn
                caseData={data}
                caseId={caseId}
                workbench={workbench}
                selectedCitationId={selectedCitationId}
                onSelectCitation={setSelectedCitationId}
                onDecisionComplete={() => setDecisionDone(true)}
                onOpenRfi={(q) => {
                  setRfiInitialQuestion(q ?? '')
                  setRfiOpen(true)
                }}
              />
            </div>
          )}
        </main>
      </div>
      <TimelineDrawer
        events={(data.events ?? []) as Record<string, unknown>[]}
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
      />
      {noticePreviewOpen && (
        <NoticePreviewModal
          caseId={caseId!}
          onClose={() => setNoticePreviewOpen(false)}
        />
      )}
    </AppShell>
  )
}
