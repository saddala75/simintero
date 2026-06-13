import { useState } from 'react';
import type { CaseState } from '../types.js';
import { useWorklist } from '../hooks/useWorklist.js';
import { CaseCard } from '../components/CaseCard.js';

const STATE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Received', value: 'RECEIVED' },
  { label: 'In Review', value: 'IN_REVIEW' },
  { label: 'Pending Info', value: 'PENDING_INFO' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Denied', value: 'DENIED' },
  { label: 'Modified', value: 'MODIFIED' },
];

const LOB_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'MA', value: 'MA' },
  { label: 'Commercial', value: 'Commercial' },
  { label: 'Medicaid', value: 'Medicaid' },
];

export function Worklist() {
  const [stateFilter, setStateFilter] = useState<CaseState | ''>('');
  const [lobFilter, setLobFilter] = useState('');

  const { cases, loading, error } = useWorklist({
    state: stateFilter || undefined,
    lob: lobFilter || undefined,
  });

  // Sort: expedited first, then standard
  const sorted = [...cases].sort((a, b) => {
    if (a.urgency === b.urgency) return 0;
    return a.urgency === 'expedited' ? -1 : 1;
  });

  return (
    <div className="worklist">
      <h1 className="worklist__title">Prior Authorization Worklist</h1>

      <div className="worklist__filters">
        <label htmlFor="state-filter">State</label>
        <select
          id="state-filter"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as CaseState | '')}
        >
          {STATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <label htmlFor="lob-filter">Line of Business</label>
        <select
          id="lob-filter"
          value={lobFilter}
          onChange={(e) => setLobFilter(e.target.value)}
        >
          {LOB_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="worklist__loading">Loading…</p>}
      {error && <p className="worklist__error">{error}</p>}

      <ul className="worklist__list">
        {sorted.map((c) => (
          <li key={c.case_id}>
            <CaseCard case={c} />
          </li>
        ))}
      </ul>

      {!loading && sorted.length === 0 && (
        <p className="worklist__empty">No cases match the current filters.</p>
      )}
    </div>
  );
}
