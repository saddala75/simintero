import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fileAppeal, getCaseDocuments } from '../api/client'
import type { AppealCategory, AppealFilingPayload, AppealOutcome, DocumentItem } from '../types'

interface Props {
  caseId?: string
  onClose: () => void
  onFiled: (caseId: string, appealId: string) => void
}

export function AppealFilingModal({ caseId: initialCaseId = '', onClose, onFiled }: Props) {
  const [caseId, setCaseId] = useState(initialCaseId)
  const [category, setCategory] = useState<AppealCategory | ''>('')
  const [grounds, setGrounds] = useState('')
  const [requestedOutcome, setRequestedOutcome] = useState<AppealOutcome | ''>('')
  const [selectedDocRefs, setSelectedDocRefs] = useState<string[]>([])

  const { data: documents = [] } = useQuery<DocumentItem[]>({
    queryKey: ['case-documents', caseId],
    queryFn: () => getCaseDocuments(caseId),
    enabled: caseId.trim().length > 10,
  })

  const mut = useMutation({
    mutationFn: () => {
      const payload: AppealFilingPayload = {
        category: category as AppealCategory,
        grounds,
        requested_outcome: requestedOutcome as AppealOutcome,
        document_refs: selectedDocRefs,
      }
      return fileAppeal(caseId, payload)
    },
    onSuccess: (data) => onFiled(caseId, data.appeal_id),
  })

  const canSubmit = caseId.trim() && category && grounds.trim() && requestedOutcome

  function toggleDoc(id: string) {
    setSelectedDocRefs(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id],
    )
  }

  return (
    <div className="en-modal-scrim" onClick={onClose}>
      <div className="en-modal-card" onClick={e => e.stopPropagation()}>
        <div className="en-modal-h">
          <div>
            <div className="en-modal-title">File appeal</div>
            <div className="en-modal-sub">Submit a new appeal against an adverse determination</div>
          </div>
          <button className="en-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="en-modal-b">
          <div className="en-field">
            <label htmlFor="appeal-case-id">Case ID</label>
            <input
              id="appeal-case-id"
              type="text"
              className="en-input"
              value={caseId}
              onChange={e => setCaseId(e.target.value)}
              placeholder="aaaaaaaa-bbbb-cccc-dddd-000000000001"
              data-testid="appeal-case-id-input"
              readOnly={!!initialCaseId}
            />
          </div>

          <div className="en-field" style={{ marginTop: 12 }}>
            <label htmlFor="appeal-category">Category</label>
            <select
              id="appeal-category"
              className="en-select"
              value={category}
              onChange={e => setCategory(e.target.value as AppealCategory | '')}
              data-testid="appeal-category-select"
            >
              <option value="">Select category…</option>
              <option value="member_request">Member request</option>
              <option value="provider_request">Provider request</option>
              <option value="regulatory_requirement">Regulatory requirement</option>
            </select>
          </div>

          <div className="en-field" style={{ marginTop: 12 }}>
            <label htmlFor="appeal-grounds">Grounds for appeal</label>
            <textarea
              id="appeal-grounds"
              className="en-textarea"
              value={grounds}
              onChange={e => setGrounds(e.target.value)}
              placeholder="Describe the basis for this appeal"
              rows={3}
              data-testid="appeal-grounds-input"
            />
          </div>

          <div className="en-field" style={{ marginTop: 12 }}>
            <label htmlFor="appeal-outcome">Requested outcome</label>
            <select
              id="appeal-outcome"
              className="en-select"
              value={requestedOutcome}
              onChange={e => setRequestedOutcome(e.target.value as AppealOutcome | '')}
              data-testid="appeal-outcome-select"
            >
              <option value="">Select requested outcome…</option>
              <option value="full_overturn">Full overturn</option>
              <option value="partial_overturn">Partial overturn</option>
            </select>
          </div>

          {documents.length > 0 && (
            <div className="en-field" style={{ marginTop: 12 }}>
              <div className="en-fl">Supporting documents</div>
              <div data-testid="appeal-doc-refs">
                {documents.map(doc => (
                  <label key={doc.id} className="en-finding-toggle">
                    <input
                      type="checkbox"
                      checked={selectedDocRefs.includes(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                    />
                    <span>{doc.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {mut.isError && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>
              {(mut.error as Error).message}
            </p>
          )}
        </div>

        <div className="en-modal-f">
          <button className="en-act" onClick={onClose}>Cancel</button>
          <button
            className="en-act primary"
            disabled={!canSubmit || mut.isPending}
            onClick={() => mut.mutate()}
            data-testid="btn-submit-appeal-filing"
          >
            {mut.isPending ? 'Filing…' : 'File appeal'}
          </button>
        </div>
      </div>
    </div>
  )
}
