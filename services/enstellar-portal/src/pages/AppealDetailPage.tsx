import { useState, useRef, useCallback } from 'react'
import type { RefObject } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCase, getCriteria, getAppealDetail } from '../api/client'
import { AppShell } from '../components/AppShell'
import { useAuth, hasRole } from '../auth/AuthContext'
import { AppealDecisionForm, type AppealFormReadiness } from '../components/AppealDecisionForm'
import type { AppealDetail, CaseDetail, CriterionItem } from '../types'

// ── Context column (left) ─────────────────────────────────────────────────────

function AppealContextColumn({
  appeal,
  caseData,
}: {
  appeal: AppealDetail | undefined
  caseData: CaseDetail | undefined
}) {
  return (
    <aside className="en-col ctx">
      <div className="en-ctx-card">
        <div className="en-ctx-h">
          <div className="en-ctx-name">{(caseData?.member as Record<string, string>)?.name ?? '—'}</div>
          <div className="en-ctx-meta">
            Member ID: {(caseData?.member as Record<string, string>)?.member_id ?? '—'}
          </div>
          <div className="en-ctx-meta">
            Case: {appeal?.case_id?.slice(0, 8).toUpperCase() ?? '—'}
          </div>
        </div>

        <div className="en-ctx-section">
          <div className="en-ctx-st">Original service</div>
          <div style={{ fontSize: 13 }}>
            {(caseData?.service_lines?.[0] as Record<string, string> | undefined)?.procedure_description ?? '—'}
          </div>
        </div>

        {appeal && (
          <>
            <div className="en-ctx-section">
              <div className="en-ctx-st">Appeal category</div>
              <span className="en-stbadge info">{appeal.category.replace(/_/g, ' ')}</span>
            </div>
            <div className="en-ctx-section">
              <div className="en-ctx-st">Grounds</div>
              <blockquote style={{ margin: '4px 0', borderLeft: '3px solid var(--line)', paddingLeft: 10, fontSize: 13, color: 'var(--ink-sec)' }}>
                {appeal.grounds}
              </blockquote>
            </div>
            <div className="en-ctx-section">
              <div className="en-ctx-st">Requested outcome</div>
              <span className="en-stbadge review">{appeal.requested_outcome.replace(/_/g, ' ')}</span>
            </div>
            <div className="en-ctx-section">
              <div className="en-ctx-st">Filed</div>
              <div style={{ fontSize: 12, color: 'var(--ink-sec)' }}>
                {new Date(appeal.filed_at).toLocaleDateString()}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

// ── Work column (center) ──────────────────────────────────────────────────────

function AppealWorkColumn({
  caseId,
  appealId,
  criteria,
  decisionDone,
  onDecisionComplete,
  onReadinessChange,
  submitRef,
}: {
  caseId: string
  appealId: string
  criteria: CriterionItem[]
  decisionDone: boolean
  onDecisionComplete: () => void
  onReadinessChange: (state: AppealFormReadiness) => void
  submitRef: RefObject<{ submit: () => void } | null>
}) {
  return (
    <section className="en-col work">
      <div className="en-work-section">
        <div className="en-ws-h">Section 1 — Original determination</div>
        <div className="en-ws-b">
          <p style={{ fontSize: 13, color: 'var(--ink-sec)' }}>
            Review the original adverse determination and the member's grounds for appeal.
          </p>
        </div>
      </div>

      <div className="en-work-section">
        <div className="en-ws-h">Section 2 — Criteria review</div>
        <div className="en-ws-b">
          {criteria.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--ink-mut)' }}>No criteria loaded.</p>
          )}
          {criteria.map(c => (
            <div key={c.id} className={`en-crit-row ${c.status}`}>
              <span className="en-crit-icon">
                {c.status === 'met' ? '✓' : c.status === 'gap' ? '⚠' : '?'}
              </span>
              <div>
                <div className="en-crit-text">{c.text}</div>
                {c.status === 'gap' && (
                  <div className="en-crit-gap-note">Gap — addressed in original determination</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="en-work-section">
        <div className="en-ws-h">Section 3 — Appeal decision</div>
        <div className="en-ws-b">
          {decisionDone ? (
            <div className="en-guard" style={{ color: 'var(--pine)', fontWeight: 600 }}>
              Decision recorded successfully.
            </div>
          ) : (
            <AppealDecisionForm
              caseId={caseId}
              appealId={appealId}
              onComplete={onDecisionComplete}
              onReadinessChange={onReadinessChange}
              submitRef={submitRef}
            />
          )}
        </div>
      </div>
    </section>
  )
}

// ── Gate column (right) ───────────────────────────────────────────────────────

function AppealGateColumn({
  decisionDone,
  appealFormState,
  ready,
  onIssue,
}: {
  decisionDone: boolean
  appealFormState: AppealFormReadiness
  ready: boolean
  onIssue: () => void
}) {
  const gateItems = [
    { label: 'Appeal filed', done: true },
    { label: 'Outcome selected', done: appealFormState.outcomeSelected },
    { label: 'Criteria reviewed', done: appealFormState.criteriaLoaded },
    { label: 'Citations added', done: appealFormState.citations },
    { label: 'Rationale complete', done: appealFormState.rationale },
    { label: 'Clinician sign-off', done: appealFormState.clinicianId && appealFormState.confirmed },
  ]
  const doneCount = gateItems.filter(i => i.done).length
  const total = gateItems.length
  const pct = Math.round((doneCount / total) * 100)

  return (
    <aside className="en-col gate">
      <div className="en-gate-card">
        <div className="en-gate-h">
          <div className="gt">Sign-off readiness</div>
          <div className="gs">Complete all steps before issuing the appeal decision</div>
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
            className={`en-issue-btn${ready ? ' ready' : ''}`}
            disabled={!ready || decisionDone}
            onClick={onIssue}
            data-testid="btn-issue-appeal-decision"
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
            {decisionDone
              ? 'Decision recorded'
              : ready
                ? 'Issue appeal decision'
                : 'Complete steps to issue'}
          </button>
        </div>
      </div>
    </aside>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AppealDetailPage() {
  const { caseId, appealId } = useParams<{ caseId: string; appealId: string }>()
  const auth = useAuth()

  const { data: caseData } = useQuery<CaseDetail>({
    queryKey: ['case', caseId],
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
  })
  const { data: appeal } = useQuery<AppealDetail>({
    queryKey: ['appeal', caseId, appealId],
    queryFn: () => getAppealDetail(caseId!, appealId!),
    enabled: !!caseId && !!appealId,
  })
  const { data: criteria = [] } = useQuery<CriterionItem[]>({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId!),
    staleTime: 60_000,
    enabled: !!caseId,
  })

  const [appealFormState, setAppealFormState] = useState<AppealFormReadiness>({
    criteriaLoaded: false,
    outcomeSelected: false,
    citations: false,
    rationale: false,
    clinicianId: false,
    confirmed: false,
  })
  const [decisionDone, setDecisionDone] = useState(false)
  const appealSubmitRef = useRef<{ submit: () => void } | null>(null)
  const handleAppealReadinessChange = useCallback(
    (s: AppealFormReadiness) => setAppealFormState(s),
    [],
  )

  const appealReady =
    appealFormState.outcomeSelected &&
    appealFormState.citations &&
    appealFormState.rationale &&
    appealFormState.clinicianId &&
    appealFormState.confirmed

  if (!hasRole(auth, 'appeals_coordinator')) {
    return (
      <AppShell breadcrumb={<b>Appeal</b>}>
        <div className="en-wrap">
          <p style={{ color: 'var(--ink-mut)', padding: '32px 0' }}>
            You do not have the appeals_coordinator role.
          </p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell noScroll breadcrumb={<b>Appeal — {appeal?.appeal_id?.slice(0, 8).toUpperCase() ?? '…'}</b>}>
      <div className="en-content md-view">
        <AppealContextColumn appeal={appeal} caseData={caseData} />
        <AppealWorkColumn
          caseId={caseId!}
          appealId={appealId!}
          criteria={criteria}
          decisionDone={decisionDone}
          onDecisionComplete={() => setDecisionDone(true)}
          onReadinessChange={handleAppealReadinessChange}
          submitRef={appealSubmitRef}
        />
        <AppealGateColumn
          decisionDone={decisionDone}
          appealFormState={appealFormState}
          ready={appealReady}
          onIssue={() => appealSubmitRef.current?.submit()}
        />
      </div>
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
            <div className="ib-t">Appeal decision recorded</div>
            <div className="ib-s">Recorded with full provenance and clinician attestation.</div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
