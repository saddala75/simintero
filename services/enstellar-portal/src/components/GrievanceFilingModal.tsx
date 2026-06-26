import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fileGrievance } from '../api/client'
import type { GrievanceFilingPayload } from '../types'

interface Props {
  caseId?: string
  onClose: () => void
  onFiled: (grievanceId: string) => void
}

const CATEGORIES = ['billing', 'access', 'quality', 'communication', 'other'] as const
const URGENCY_OPTIONS = ['standard', 'expedited'] as const

export function GrievanceFilingModal({ caseId: initialCaseId = '', onClose, onFiled }: Props) {
  const [caseId, setCaseId] = useState(initialCaseId)
  const [memberRef, setMemberRef] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<'standard' | 'expedited'>('standard')

  const canSubmit = memberRef.trim().length > 0

  const mut = useMutation({
    mutationFn: () => {
      const payload: GrievanceFilingPayload = {
        member_ref: memberRef.trim(),
        urgency,
        ...(caseId.trim() ? { case_id: caseId.trim() } : {}),
        ...(category ? { category } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }
      return fileGrievance(payload)
    },
    onSuccess: (data) => {
      onFiled(data.grievance_id)
    },
  })

  return (
    <div className="en-modal-overlay" role="dialog" aria-modal="true">
      <div className="en-modal">
        <header className="en-modal-header">
          <h2 className="en-modal-title">File grievance</h2>
          <button className="en-modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="en-modal-body">
          <label className="en-field-label">Member reference *</label>
          <input
            className="en-input"
            data-testid="grievance-member-ref-input"
            value={memberRef}
            onChange={e => setMemberRef(e.target.value)}
            placeholder="member-001"
          />

          <label className="en-field-label">Case ID (optional)</label>
          <input
            className="en-input"
            data-testid="grievance-case-id-input"
            value={caseId}
            onChange={e => setCaseId(e.target.value)}
            readOnly={!!initialCaseId}
            placeholder="leave blank if not case-linked"
          />

          <label className="en-field-label">Category</label>
          <select
            className="en-select"
            data-testid="grievance-category-select"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="">— select —</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>

          <label className="en-field-label">Description</label>
          <textarea
            className="en-textarea"
            data-testid="grievance-description-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe the grievance…"
          />

          <label className="en-field-label">Urgency</label>
          <select
            className="en-select"
            data-testid="grievance-urgency-select"
            value={urgency}
            onChange={e => setUrgency(e.target.value as 'standard' | 'expedited')}
          >
            {URGENCY_OPTIONS.map(u => (
              <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
            ))}
          </select>
        </div>

        {mut.isError && (
          <p className="en-error-text">Failed to file grievance. Please try again.</p>
        )}

        <footer className="en-modal-footer">
          <button className="en-btn en-btn--secondary" onClick={onClose}>Cancel</button>
          <button
            className="en-btn en-btn--primary"
            data-testid="btn-submit-grievance-filing"
            disabled={!canSubmit || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Filing…' : 'File grievance'}
          </button>
        </footer>
      </div>
    </div>
  )
}
