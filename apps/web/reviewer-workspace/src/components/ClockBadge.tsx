import type { ClockState } from '../types.js';

interface ClockBadgeProps {
  state: ClockState;
  deadline?: string;
}

const BADGE_STYLES: Record<ClockState, string> = {
  running: 'clock-badge clock-badge--running',
  warning: 'clock-badge clock-badge--warning',
  breached: 'clock-badge clock-badge--breached',
};

const BADGE_LABELS: Record<ClockState, string> = {
  running: 'Running',
  warning: 'Warning',
  breached: 'Breached',
};

export function ClockBadge({ state, deadline }: ClockBadgeProps) {
  return (
    <span
      className={BADGE_STYLES[state]}
      title={deadline ? `Deadline: ${deadline}` : undefined}
      aria-label={`Clock ${BADGE_LABELS[state]}`}
    >
      {BADGE_LABELS[state]}
    </span>
  );
}
