import type { CaseListItem } from '../types.js';
import { ClockBadge } from './ClockBadge.js';

interface CaseCardProps {
  case: CaseListItem;
  onClick?: () => void;
}

export function CaseCard({ case: c, onClick }: CaseCardProps) {
  const shortId = c.case_id.slice(-8);

  return (
    <div
      className="case-card"
      data-case-id={c.case_id}
      data-urgency={c.urgency}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="case-card__header">
        <span className="case-card__id" title={c.case_id}>
          ...{shortId}
        </span>
        <span
          className={`case-card__urgency-badge case-card__urgency-badge--${c.urgency}`}
          aria-label={`Urgency: ${c.urgency}`}
        >
          {c.urgency}
        </span>
        {c.clock && (
          <ClockBadge state={c.clock.state} deadline={c.clock.deadline} />
        )}
      </div>
      <div className="case-card__body">
        <span className="case-card__state">{c.state}</span>
        <span className="case-card__member">{c.member_ref}</span>
        <span className="case-card__lob">{c.lob}</span>
      </div>
    </div>
  );
}
