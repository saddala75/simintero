import { useState } from 'react';
import type { DeterminationOutcome } from '../types.js';

interface DeterminationModalProps {
  onSubmit: (outcome: DeterminationOutcome, rationale: string) => void;
  onClose: () => void;
}

const RATIONALE_REQUIRED_OUTCOMES: ReadonlySet<DeterminationOutcome> = new Set(['denied', 'modified']);

export function DeterminationModal({ onSubmit, onClose }: DeterminationModalProps) {
  const [outcome, setOutcome] = useState<DeterminationOutcome | ''>('');
  const [rationale, setRationale] = useState('');

  const rationaleRequired =
    outcome !== '' && RATIONALE_REQUIRED_OUTCOMES.has(outcome as DeterminationOutcome);
  const rationaleEmpty = rationale.trim() === '';
  const submitDisabled = outcome === '' || (rationaleRequired && rationaleEmpty);

  function handleSubmit() {
    if (submitDisabled) return;
    onSubmit(outcome as DeterminationOutcome, rationale.trim());
  }

  return (
    <div className="determination-modal" role="dialog" aria-modal="true" aria-label="Record Determination">
      <div className="determination-modal__content">
        <h2 className="determination-modal__title">Record Determination</h2>

        <label className="determination-modal__label" htmlFor="outcome-select">
          Outcome
        </label>
        <select
          id="outcome-select"
          className="determination-modal__select"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as DeterminationOutcome | '')}
        >
          <option value="">— select outcome —</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="modified">Modified</option>
          <option value="partial">Partial</option>
        </select>

        <label className="determination-modal__label" htmlFor="rationale-textarea">
          Rationale
        </label>
        <textarea
          id="rationale-textarea"
          className="determination-modal__textarea"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Enter rationale…"
          rows={5}
        />

        {rationaleRequired && rationaleEmpty && (
          <p className="determination-modal__validation-message" role="alert">
            Rationale is required for denied/modified outcomes.
          </p>
        )}

        <div className="determination-modal__actions">
          <button
            className="determination-modal__submit"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            Submit
          </button>
          <button className="determination-modal__cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
