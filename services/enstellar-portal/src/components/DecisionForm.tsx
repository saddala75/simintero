import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { submitDecision, submitAdverseDecision } from '../api/client'
import type { AdverseOutcome } from '../types'

interface Props {
  caseId: string
  onComplete?: () => void
}

const ADVERSE_OUTCOME_LABELS: Record<AdverseOutcome, string> = {
  denied: 'Deny — not medically necessary',
  partially_denied: 'Partial denial — approve some lines',
  adverse_modification: 'Modification — alternative service',
}

// ── Adverse panel ─────────────────────────────────────────────────────────────

function AdversePanel({
  caseId,
  onCancel,
  onSuccess,
}: {
  caseId: string
  onCancel: () => void
  onSuccess: (outcome: AdverseOutcome) => void
}) {
  const [outcome, setOutcome] = useState<AdverseOutcome>('denied')
  const [reason, setReason] = useState('')
  const [clinicianId, setClinicianId] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const canSubmit = reason.trim().length > 0 && clinicianId.trim().length > 0 && confirmed

  const mut = useMutation({
    mutationFn: () => submitAdverseDecision(caseId, outcome, reason.trim(), clinicianId.trim()),
    onSuccess: () => onSuccess(outcome),
  })

  return (
    <section
      data-testid="adverse-panel"
      className="en-adverse-panel"
    >
      <h4>Record Adverse Determination</h4>

      {/* Step 1: type */}
      <div className="en-field">
        <label htmlFor="adverse-outcome-select">Determination type</label>
        <select
          id="adverse-outcome-select"
          value={outcome}
          onChange={e => setOutcome(e.target.value as AdverseOutcome)}
          data-testid="adverse-outcome"
          className="en-select"
        >
          {(Object.keys(ADVERSE_OUTCOME_LABELS) as AdverseOutcome[]).map(k => (
            <option key={k} value={k}>{ADVERSE_OUTCOME_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {/* Step 2: clinical reason */}
      <div className="en-field">
        <label htmlFor="adverse-reason-text">Clinical rationale <span style={{ color: 'var(--red)' }}>*</span></label>
        <textarea
          id="adverse-reason-text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Document the clinical basis for this determination. This will inform the member and provider notice."
          rows={4}
          data-testid="adverse-reason"
          className="en-textarea"
        />
      </div>

      {/* Step 3: clinician ID */}
      <div className="en-field">
        <label htmlFor="adverse-clinician-id-input">Clinician ID (NPI or internal) <span style={{ color: 'var(--red)' }}>*</span></label>
        <input
          id="adverse-clinician-id-input"
          type="text"
          value={clinicianId}
          onChange={e => setClinicianId(e.target.value)}
          placeholder="e.g. 1234567890"
          data-testid="adverse-clinician-id"
          className="en-input"
        />
      </div>

      {/* Step 4: attestation */}
      <div className="en-attest">
        <input
          type="checkbox"
          id="adverse-confirm"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          data-testid="adverse-confirm-checkbox"
        />
        <label htmlFor="adverse-confirm">
          I am a licensed physician reviewer. I have reviewed the clinical record and applicable criteria, and I attest that this adverse determination reflects my independent clinical judgment. I understand this action is final, requires human sign-off, and will be recorded with full provenance.
        </label>
      </div>

      {mut.isError && (
        <p role="alert" style={{ color: 'var(--red)', marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
          Error: {(mut.error as Error).message}
        </p>
      )}

      <div className="en-decision-actions">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={!canSubmit || mut.isPending}
          data-testid="btn-submit-adverse"
          className="en-act danger"
          style={!canSubmit ? { opacity: .45, cursor: 'not-allowed' } : undefined}
        >
          {mut.isPending ? 'Recording…' : 'Issue adverse determination'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={mut.isPending}
          data-testid="btn-cancel-adverse"
          className="en-act"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

// ── Decision form ─────────────────────────────────────────────────────────────

const OUTCOME_LABEL: Record<AdverseOutcome, string> = {
  denied: 'Denied',
  partially_denied: 'Partially Denied',
  adverse_modification: 'Adverse Modification',
}

export function DecisionForm({ caseId, onComplete }: Props) {
  const [reason, setReason] = useState('')
  const [showAdverse, setShowAdverse] = useState(false)
  const [confirmedOutcome, setConfirmedOutcome] = useState<
    { kind: 'standard'; outcome: string } | { kind: 'adverse'; outcome: AdverseOutcome } | null
  >(null)

  const mut = useMutation({
    mutationFn: (outcome: 'approved' | 'escalate') =>
      submitDecision(caseId, outcome, reason || undefined),
    onSuccess: (_, outcome) => {
      setConfirmedOutcome({ kind: 'standard', outcome })
      onComplete?.()
    },
  })

  if (confirmedOutcome) {
    const isAdverse = confirmedOutcome.kind === 'adverse'
    const label = isAdverse
      ? `Adverse determination recorded: ${OUTCOME_LABEL[confirmedOutcome.outcome as AdverseOutcome]}`
      : confirmedOutcome.outcome === 'approved'
        ? 'Decision submitted: Approved'
        : 'Escalated for MD review'

    return (
      <div className="en-composer" data-testid="decision-confirmed">
        <div className="en-composer-h">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="ct">Decision recorded</span>
        </div>
        <div className="en-composer-b">
          <div className={`en-outcome-banner ${isAdverse ? 'adverse' : 'ok'}`}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <path d="M4 8.5l2.5 2.5L12 5" stroke={isAdverse ? 'var(--red)' : 'var(--ok)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div className="ob-t" style={{ color: isAdverse ? 'var(--red-deep)' : 'var(--ok)' }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mut)', marginTop: 3 }}>
                Recorded with full provenance. The case timeline has been updated.
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="en-composer">
      <div className="en-composer-h">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
          <path d="M3 13l1-3 7-7 2 2-7 7-3 1z" stroke="var(--pine)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <span className="ct">Reviewer decision</span>
      </div>
      <div className="en-composer-b">
        {!showAdverse && (
          <div className="en-rec">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ flex: '0 0 auto', marginTop: 1, color: 'var(--pine)' }}>
              <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 5v3l2 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <div>
              <div className="rt">Ready to record a decision</div>
              <div className="rs">Approve within scope, escalate for MD review, or initiate an adverse determination below.</div>
            </div>
          </div>
        )}

        {!showAdverse && (
          <>
            <label
              htmlFor="decision-reason-text"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', color: 'var(--ink-mut)', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--mono)' }}
            >
              Reviewer note (recorded to the case)
            </label>
            <textarea
              id="decision-reason-text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Document your clinical reasoning. Captured in the audit trail with your name and timestamp."
              rows={3}
              data-testid="decision-reason"
              className="en-textarea"
            />
          </>
        )}

        {mut.isError && (
          <p role="alert" style={{ color: 'var(--red)', fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            Error: {(mut.error as Error).message}
          </p>
        )}

        {!showAdverse && (
          <div className="en-decision-actions">
            <button
              type="button"
              onClick={() => mut.mutate('approved')}
              disabled={mut.isPending}
              data-testid="btn-approve"
              className="en-act primary"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="7" width="10" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {mut.isPending ? 'Recording…' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => mut.mutate('escalate')}
              disabled={mut.isPending}
              data-testid="btn-escalate"
              className="en-act"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              Refer to MD
            </button>
            <button
              type="button"
              onClick={() => setShowAdverse(true)}
              disabled={mut.isPending}
              data-testid="btn-adverse"
              style={{ color: 'var(--red)', borderColor: 'rgba(178,58,72,.4)' }}
              className="en-act"
            >
              Adverse determination…
            </button>
          </div>
        )}

        {!showAdverse && (
          <div className="en-guard">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Adverse determinations require clinician sign-off and are recorded with full provenance. AI cannot issue or sign a determination.
          </div>
        )}

        {showAdverse && (
          <AdversePanel
            caseId={caseId}
            onCancel={() => setShowAdverse(false)}
            onSuccess={outcome => {
              setShowAdverse(false)
              setConfirmedOutcome({ kind: 'adverse', outcome })
              onComplete?.()
            }}
          />
        )}
      </div>
    </div>
  )
}
