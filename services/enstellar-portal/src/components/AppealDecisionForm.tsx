import { useState, useEffect, useImperativeHandle } from 'react'
import type { RefObject } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getCriteria, submitAppealDecision } from '../api/client'
import type { AppealDecision, AppealDecisionPayload } from '../types'

export type AppealFormReadiness = {
  criteriaLoaded: boolean
  outcomeSelected: boolean
  citations: boolean
  rationale: boolean
  clinicianId: boolean
  confirmed: boolean
}

interface Props {
  caseId: string
  appealId: string
  onComplete: () => void
  onReadinessChange: (state: AppealFormReadiness) => void
  submitRef: RefObject<{ submit: () => void } | null>
}

export function AppealDecisionForm({
  caseId,
  appealId,
  onComplete,
  onReadinessChange,
  submitRef,
}: Props) {
  const { isLoading: criteriaLoading, isError: criteriaError } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId),
    staleTime: 60_000,
  })

  const [outcome, setOutcome] = useState<AppealDecision | null>(null)
  const [citations, setCitations] = useState<string[]>([])
  const [citationInput, setCitationInput] = useState('')
  const [rationale, setRationale] = useState('')
  const [clinicianId, setClinicianId] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const mut = useMutation({
    mutationFn: () => {
      const payload: AppealDecisionPayload = {
        decision: outcome!,
        rationale,
        citations,
        clinician_id: clinicianId,
        sign_off_confirmed: true,
      }
      return submitAppealDecision(caseId, appealId, payload)
    },
    onSuccess: () => onComplete(),
  })

  useImperativeHandle(
    submitRef,
    () => ({ submit: () => { if (!mut.isPending) mut.mutate() } }),
    [mut],
  )

  useEffect(() => {
    onReadinessChange({
      criteriaLoaded: !criteriaLoading && !criteriaError,
      outcomeSelected: outcome !== null,
      citations: citations.length > 0,
      rationale: rationale.trim().length > 0,
      clinicianId: clinicianId.trim().length > 0,
      confirmed,
    })
  }, [criteriaLoading, criteriaError, outcome, citations, rationale, clinicianId, confirmed, onReadinessChange])

  function addCitation() {
    const cit = citationInput.trim()
    if (cit && !citations.includes(cit)) {
      setCitations(prev => [...prev, cit])
    }
    setCitationInput('')
  }

  return (
    <div className="en-md-adverse-form" data-testid="appeal-decision-form">
      {criteriaLoading && (
        <div className="en-guard" style={{ marginTop: 0, marginBottom: 12 }}>
          Loading criteria…
        </div>
      )}
      {criteriaError && (
        <div role="alert" className="en-guard" style={{ marginTop: 0, marginBottom: 12, color: 'var(--amber)', fontWeight: 600 }}>
          Could not load criteria. You may still proceed.
        </div>
      )}

      {/* Outcome */}
      <div className="en-field">
        <div className="en-fl">
          Appeal decision <span style={{ color: 'var(--red)' }}>*</span>
        </div>
        <label className="en-finding-toggle">
          <input
            type="radio"
            name="appeal-outcome"
            value="upheld"
            checked={outcome === 'upheld'}
            onChange={() => setOutcome('upheld')}
            data-testid="appeal-outcome-uphold"
          />
          <span>Uphold (adverse stands)</span>
        </label>
        <label className="en-finding-toggle" style={{ marginTop: 6 }}>
          <input
            type="radio"
            name="appeal-outcome"
            value="overturned"
            checked={outcome === 'overturned'}
            onChange={() => setOutcome('overturned')}
            data-testid="appeal-outcome-overturn"
          />
          <span>Overturn (decision reversed)</span>
        </label>
      </div>

      {/* Citations */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <div className="en-fl">Supporting citations</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={citationInput}
            onChange={e => setCitationInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCitation()
              }
            }}
            placeholder="e.g. InterQual 2025 §3.4.1"
            data-testid="appeal-citation-input"
            className="en-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addCitation}
            className="en-act"
            data-testid="appeal-add-citation"
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Add
          </button>
        </div>
        {citations.length > 0 && (
          <div className="en-chips" style={{ marginTop: 6 }}>
            {citations.map(cit => (
              <span key={cit} className="en-chip-on">
                {cit}
                <button
                  type="button"
                  onClick={() => setCitations(prev => prev.filter(c => c !== cit))}
                  aria-label={`Remove citation ${cit}`}
                  className="en-chip-x"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Rationale */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <label htmlFor="appeal-rationale-input">
          Clinical rationale <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <textarea
          id="appeal-rationale-input"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder="Document the clinical basis for this appeal decision."
          rows={4}
          data-testid="appeal-rationale"
          className="en-textarea"
        />
      </div>

      {/* Clinician ID */}
      <div className="en-field" style={{ marginTop: 10 }}>
        <label htmlFor="appeal-clinician-id-input">
          Clinician ID (NPI or internal) <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          id="appeal-clinician-id-input"
          type="text"
          value={clinicianId}
          onChange={e => setClinicianId(e.target.value)}
          placeholder="e.g. 1234567890"
          data-testid="appeal-clinician-id"
          className="en-input"
        />
      </div>

      {/* Attestation */}
      <div className="en-attest" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          id="appeal-confirm"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          data-testid="appeal-confirm-checkbox"
        />
        <label htmlFor="appeal-confirm" style={{ fontSize: 12, color: 'var(--ink-sec)' }}>
          I confirm this appeal decision is accurate and complete.
        </label>
      </div>

      {mut.isError && (
        <p
          role="alert"
          style={{ color: 'var(--red)', marginTop: 10, fontSize: 13, fontWeight: 600 }}
        >
          Error: {(mut.error as Error).message}
        </p>
      )}
    </div>
  )
}
