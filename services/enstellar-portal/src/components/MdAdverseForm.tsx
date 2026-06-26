import { useState, useEffect, useImperativeHandle, useMemo } from 'react'
import type { RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { submitAdverseDecision, getCriteria } from '../api/client'
import type { AdverseOutcome, CriterionItem, FindingSection } from '../types'

export type MdFormReadiness = {
  criteriaLoaded: boolean
  hasFindings: boolean
  citations: boolean
  rationale: boolean
  clinicianId: boolean
  confirmed: boolean
}

interface Props {
  caseId: string
  determinationType: AdverseOutcome
  onComplete: () => void
  onReadinessChange: (state: MdFormReadiness) => void
  submitRef: RefObject<{ submit: () => void } | null>
}

export function MdAdverseForm({
  caseId,
  determinationType,
  onComplete,
  onReadinessChange,
  submitRef,
}: Props) {
  const queryClient = useQueryClient()

  const { data: criteria = [], isLoading: criteriaLoading, isError: criteriaError } = useQuery({
    queryKey: ['criteria', caseId],
    queryFn: () => getCriteria(caseId),
    staleTime: 60_000,
  })

  // Only gap/unknown criteria are relevant for an adverse determination
  const gapCriteria = useMemo(
    () =>
      criteria.filter(
        (c): c is CriterionItem & { status: 'gap' | 'unknown' } =>
          c.status === 'gap' || c.status === 'unknown',
      ),
    [criteria],
  )

  // Deselected set: starts empty (all gap criteria selected by default).
  // MD unchecks to exclude a finding from the submission.
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set())

  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [reasonCodeInput, setReasonCodeInput] = useState('')
  const [citations, setCitations] = useState<string[]>([])
  const [citationInput, setCitationInput] = useState('')
  const [rationale, setRationale] = useState('')
  const [clinicianId, setClinicianId] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const mut = useMutation({
    mutationFn: () => {
      const selectedFindings: FindingSection[] = gapCriteria
        .filter(c => !deselectedIds.has(c.id))
        .map(c => ({
          criterion_id: c.criterion_id,
          text: c.text,
          status: c.status,
        }))

      return submitAdverseDecision(
        caseId,
        determinationType,
        rationale.trim(),
        clinicianId.trim(),
        {
          finding_sections: selectedFindings,
          reason_codes: reasonCodes,
          citations,
        },
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] })
      onComplete()
    },
  })

  useImperativeHandle(
    submitRef,
    () => ({ submit: () => { if (!mut.isPending) mut.mutate() } }),
    [mut],
  )

  useEffect(() => {
    onReadinessChange({
      criteriaLoaded: !criteriaLoading && !criteriaError,
      hasFindings: gapCriteria.some(c => !deselectedIds.has(c.id)),
      citations: citations.length > 0,
      rationale: rationale.trim().length > 0,
      clinicianId: clinicianId.trim().length > 0,
      confirmed,
    })
  }, [criteriaLoading, criteriaError, gapCriteria, deselectedIds, citations, rationale, clinicianId, confirmed, onReadinessChange])

  function toggleFinding(id: string) {
    setDeselectedIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function addReasonCode() {
    const code = reasonCodeInput.trim()
    if (code && !reasonCodes.includes(code)) {
      setReasonCodes(prev => [...prev, code])
    }
    setReasonCodeInput('')
  }

  function addCitation() {
    const cit = citationInput.trim()
    if (cit && !citations.includes(cit)) {
      setCitations(prev => [...prev, cit])
    }
    setCitationInput('')
  }

  return (
    <div className="en-md-adverse-form" data-testid="md-adverse-form">

      {criteriaLoading && (
        <div className="en-guard" style={{ marginTop: 0, marginBottom: 12 }}>
          Loading criteria…
        </div>
      )}
      {criteriaError && (
        <div role="alert" className="en-guard" style={{ marginTop: 0, marginBottom: 12, color: 'var(--amber)', fontWeight: 600 }}>
          Could not load criteria — findings section may be incomplete. You may still submit.
        </div>
      )}

      {/* Gap findings — pre-populated, MD confirms or deselects */}
      {gapCriteria.length > 0 && (
        <div className="en-field">
          <div className="en-fl">Gap findings driving this determination</div>
          <div className="en-finding-list">
            {gapCriteria.map(c => (
              <label
                key={c.id}
                className="en-finding-toggle"
                data-testid={`finding-toggle-${c.criterion_id}`}
              >
                <input
                  type="checkbox"
                  checked={!deselectedIds.has(c.id)}
                  onChange={() => toggleFinding(c.id)}
                />
                <span className="fcode">{c.criterion_id}</span>
                <span className="ftext">{c.text}</span>
                <span className="fstat">{c.status}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Reason codes */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <div className="en-fl">Clinical reason codes (ICD / CPT)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={reasonCodeInput}
            onChange={e => setReasonCodeInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addReasonCode()
              }
            }}
            placeholder="e.g. M54.5"
            data-testid="reason-code-input"
            className="en-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addReasonCode}
            className="en-act"
            data-testid="add-reason-code"
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Add
          </button>
        </div>
        {reasonCodes.length > 0 && (
          <div className="en-chips" style={{ marginTop: 6 }}>
            {reasonCodes.map(code => (
              <span key={code} className="en-chip-on">
                {code}
                <button
                  type="button"
                  onClick={() => setReasonCodes(prev => prev.filter(c => c !== code))}
                  data-testid={`remove-code-${code}`}
                  aria-label={`Remove reason code ${code}`}
                  className="en-chip-x"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
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
            data-testid="citation-input"
            className="en-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={addCitation}
            className="en-act"
            data-testid="add-citation"
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
                  data-testid={`remove-citation-${cit}`}
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

      {/* Clinical rationale */}
      <div className="en-field" style={{ marginTop: 14 }}>
        <label htmlFor="md-rationale">
          Clinical rationale <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <textarea
          id="md-rationale"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder="Document the clinical basis for this adverse determination. This will inform the member and provider notice."
          rows={4}
          data-testid="md-rationale"
          className="en-textarea"
        />
      </div>

      {/* Clinician ID */}
      <div className="en-field" style={{ marginTop: 10 }}>
        <label htmlFor="md-clinician-id">
          Clinician ID (NPI or internal) <span style={{ color: 'var(--red)' }}>*</span>
        </label>
        <input
          id="md-clinician-id"
          type="text"
          value={clinicianId}
          onChange={e => setClinicianId(e.target.value)}
          placeholder="e.g. 1234567890"
          data-testid="md-clinician-id"
          className="en-input"
        />
      </div>

      {/* Attestation */}
      <div className="en-attest" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          id="md-confirm"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          data-testid="md-confirm-checkbox"
        />
        <label htmlFor="md-confirm" style={{ fontSize: 12, color: 'var(--ink-sec)' }}>
          I am a licensed physician reviewer. I have reviewed the clinical record and
          applicable criteria, and I attest that this adverse determination reflects my
          independent clinical judgment. I understand this action is final, requires
          human sign-off, and will be recorded with full provenance.
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
