/**
 * computeDeadline — business-calendar arithmetic.
 *
 * Phase 1: excludes Sat/Sun only; no holidays.
 */

export interface LimitValue {
  value: number;
  unit: 'business_days' | 'hours' | 'calendar_days';
}

export interface DeadlineInput {
  startedAt: Date;
  limitValue: LimitValue;
}

export function computeDeadline(input: DeadlineInput): Date {
  const { startedAt, limitValue } = input;

  if (limitValue.unit === 'hours') {
    return new Date(startedAt.getTime() + limitValue.value * 60 * 60 * 1000);
  }

  if (limitValue.unit === 'calendar_days') {
    return new Date(startedAt.getTime() + limitValue.value * 24 * 60 * 60 * 1000);
  }

  // business_days: skip Sat (6) and Sun (0)
  // Count starts AFTER startedAt; zero business days returns startedAt unchanged.
  // Use UTC methods throughout to avoid local-timezone dayOfWeek shifts.
  let count = 0;
  const current = new Date(startedAt);
  while (count < limitValue.value) {
    current.setUTCDate(current.getUTCDate() + 1);
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }
  return current;
}

/**
 * Temporal activity wrapper — thin shim so ClockWorkflow can proxy this.
 */
export async function computeDeadlineActivity(
  limitValue: LimitValue,
  startedAtIso: string,
): Promise<string> {
  const deadline = computeDeadline({ startedAt: new Date(startedAtIso), limitValue });
  return deadline.toISOString();
}
