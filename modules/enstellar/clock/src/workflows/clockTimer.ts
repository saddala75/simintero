/**
 * clockTimer — Pure async timer for clock breach/warning timing.
 *
 * Extracted from the Temporal workflow so it can be exercised in unit
 * tests using vitest fake timers (vi.useFakeTimers / vi.advanceTimersByTimeAsync)
 * without requiring a live Temporal binary.
 *
 * The Temporal workflow (ClockWorkflow.ts) owns the signal-responsive
 * loop; this module owns only the "fire at elapsed ms" contract, which
 * is what the spec invariant ("breach within 1 s of deadline") tests.
 */

export interface ClockTimerCallbacks {
  onWarning: () => Promise<void>;
  onBreach: () => Promise<void>;
}

/**
 * Runs a two-phase async timer:
 *  1. After `warningMs`, calls `onWarning` if `isSatisfied()` returns false.
 *  2. After `totalMs` total, calls `onBreach` if `isSatisfied()` returns false.
 *
 * Uses plain `setTimeout` so vitest fake timers can control progression.
 *
 * @param totalMs   Total milliseconds until breach.
 * @param warningMs Milliseconds until warning (must be < totalMs).
 * @param isSatisfied Checked before each callback — skips emission when true.
 * @param callbacks Async callbacks for warning and breach events.
 */
export async function runClockTimer(
  totalMs: number,
  warningMs: number,
  isSatisfied: () => boolean,
  callbacks: ClockTimerCallbacks,
): Promise<void> {
  // Phase 1 — warning
  await new Promise<void>(resolve => setTimeout(resolve, warningMs));
  if (!isSatisfied()) {
    await callbacks.onWarning();
  }

  // Phase 2 — breach (fires at totalMs from start)
  const breachDelay = totalMs - warningMs;
  await new Promise<void>(resolve => setTimeout(resolve, breachDelay));
  if (!isSatisfied()) {
    await callbacks.onBreach();
  }
}
