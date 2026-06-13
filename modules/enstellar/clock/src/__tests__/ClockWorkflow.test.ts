/**
 * ClockWorkflow state machine tests — no Temporal server required.
 *
 * Strategy: exercise the pure advanceClockState() function extracted
 * from ClockWorkflow.ts. This tests the signal/pause/resume/satisfy
 * state machine without spinning up a Temporal worker.
 *
 * Also includes timer-invariant tests using vitest fake timers to verify
 * the breach-timing contract ("breach fires within 1 s of deadline").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  advanceClockState,
  initialClockMachineState,
  type ClockMachineState,
} from '../workflows/ClockWorkflow.js';
import { runClockTimer } from '../workflows/clockTimer.js';

describe('ClockWorkflow state machine', () => {
  it('starts in running state (not paused, not satisfied)', () => {
    const state = initialClockMachineState();
    expect(state.satisfied).toBe(false);
    expect(state.paused).toBe(false);
    expect(state.elapsedBanked).toBe(0);
    expect(state.pauseStart).toBeNull();
  });

  it('transitions from running to paused on pauseClock signal', () => {
    const state = initialClockMachineState();
    const pausedAt = Date.now();
    const next = advanceClockState(state, { type: 'pause', pausedAt });
    expect(next.paused).toBe(true);
    expect(next.pauseStart).toBe(pausedAt);
    expect(next.satisfied).toBe(false);
  });

  it('resumes correctly and adjusts elapsedBanked', () => {
    const pausedAt = 1000;
    const resumedAt = 4000; // 3000ms pause

    const after_pause = advanceClockState(initialClockMachineState(), {
      type: 'pause',
      pausedAt,
    });
    const after_resume = advanceClockState(after_pause, {
      type: 'resume',
      resumedAt,
    });

    expect(after_resume.paused).toBe(false);
    expect(after_resume.pauseStart).toBeNull();
    expect(after_resume.elapsedBanked).toBe(3000);
  });

  it('accumulates elapsedBanked across multiple pause/resume cycles', () => {
    let state = initialClockMachineState();

    // First pause: 2000ms
    state = advanceClockState(state, { type: 'pause', pausedAt: 1000 });
    state = advanceClockState(state, { type: 'resume', resumedAt: 3000 });
    expect(state.elapsedBanked).toBe(2000);

    // Second pause: 1000ms
    state = advanceClockState(state, { type: 'pause', pausedAt: 5000 });
    state = advanceClockState(state, { type: 'resume', resumedAt: 6000 });
    expect(state.elapsedBanked).toBe(3000);
  });

  it('reaches satisfied state without breach on satisfy signal', () => {
    const state = initialClockMachineState();
    const next = advanceClockState(state, { type: 'satisfy' });
    expect(next.satisfied).toBe(true);
    expect(next.paused).toBe(false);
  });

  it('satisfied clock does not emit breach — satisfied flag blocks breach path', () => {
    // Simulate: running → satisfied
    // The workflow only calls emitBreach if !satisfied after deadline.
    let state = initialClockMachineState();
    state = advanceClockState(state, { type: 'satisfy' });
    // After deadline, the workflow checks: if (!satisfied) emitBreach()
    // This test verifies the flag is set correctly.
    expect(state.satisfied).toBe(true);
  });

  it('ignores pause when already paused', () => {
    let state = initialClockMachineState();
    state = advanceClockState(state, { type: 'pause', pausedAt: 1000 });
    const afterSecondPause = advanceClockState(state, { type: 'pause', pausedAt: 2000 });
    // pauseStart should remain the original 1000, not overwritten
    expect(afterSecondPause.pauseStart).toBe(1000);
  });

  it('ignores resume when not paused', () => {
    const state = initialClockMachineState();
    const after = advanceClockState(state, { type: 'resume', resumedAt: 5000 });
    expect(after.elapsedBanked).toBe(0);
    expect(after.pauseStart).toBeNull();
  });

  it('ignores pause when already satisfied', () => {
    let state = initialClockMachineState();
    state = advanceClockState(state, { type: 'satisfy' });
    const after = advanceClockState(state, { type: 'pause', pausedAt: 9999 });
    expect(after.paused).toBe(false);
    expect(after.pauseStart).toBeNull();
  });

  it('does not mutate the original state (immutability)', () => {
    const original: ClockMachineState = initialClockMachineState();
    const next = advanceClockState(original, { type: 'satisfy' });
    expect(original.satisfied).toBe(false); // original unchanged
    expect(next.satisfied).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fix 1 — in-progress pause must be subtracted from elapsed
  // -------------------------------------------------------------------------

  it('paused clock: elapsed does not advance past the paused-at offset', () => {
    const started = 1000;
    const pausedAt = 3000; // 2000 ms into the clock

    let state = initialClockMachineState();
    state = advanceClockState(state, { type: 'pause', pausedAt });

    // Simulate "a lot of time has passed" while the clock remains paused
    const now = 20000;
    const livePauseMs =
      state.paused && state.pauseStart !== null ? now - state.pauseStart : 0;
    const elapsed = now - started - state.elapsedBanked - livePauseMs;

    // elapsed should be frozen at the moment of pause (3000 - 1000 = 2000 ms)
    expect(elapsed).toBe(2000);
  });

  it('paused clock at deadline: does NOT reach totalMs while still paused', () => {
    const started = 0;
    const totalMs = 10_000;
    const pausedAt = 5000; // paused halfway through

    let state = initialClockMachineState();
    state = advanceClockState(state, { type: 'pause', pausedAt });

    // Simulate "now" being well past the deadline
    const now = started + totalMs + 5000; // 5 s after deadline
    const livePauseMs =
      state.paused && state.pauseStart !== null ? now - state.pauseStart : 0;
    const elapsed = now - started - state.elapsedBanked - livePauseMs;

    // elapsed is frozen at (pausedAt - started) = 5000, below the 10 000 ms deadline
    expect(elapsed).toBeLessThan(totalMs);
    expect(elapsed).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// ClockTimer — breach timing (vitest fake timers, no Temporal binary needed)
// ---------------------------------------------------------------------------

describe('ClockTimer — breach timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warning fires after warningMs; breach fires after totalMs, not before', async () => {
    const onWarning = vi.fn().mockResolvedValue(undefined);
    const onBreach = vi.fn().mockResolvedValue(undefined);
    const isSatisfied = vi.fn().mockReturnValue(false);

    const timerPromise = runClockTimer(1000, 750, isSatisfied, { onWarning, onBreach });

    // Advance to just past the warning threshold
    await vi.advanceTimersByTimeAsync(800);
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onBreach).not.toHaveBeenCalled();

    // Advance to just past the breach deadline
    await vi.advanceTimersByTimeAsync(200);
    await timerPromise;
    expect(onBreach).toHaveBeenCalledOnce();
  });

  it('satisfied clock does NOT emit breach even when timer fires', async () => {
    const onBreach = vi.fn().mockResolvedValue(undefined);
    let satisfied = false;
    const isSatisfied = () => satisfied;

    const timerPromise = runClockTimer(1000, 750, isSatisfied, {
      onWarning: vi.fn().mockResolvedValue(undefined),
      onBreach,
    });

    // Satisfy before the breach deadline
    await vi.advanceTimersByTimeAsync(500);
    satisfied = true;
    await vi.advanceTimersByTimeAsync(600);
    await timerPromise;

    expect(onBreach).not.toHaveBeenCalled();
  });

  it('breach fires within 1 second of deadline (spec invariant)', async () => {
    const onBreach = vi.fn().mockResolvedValue(undefined);

    const deadline = 1000; // 1 s total
    const timerPromise = runClockTimer(deadline, deadline * 0.8, () => false, {
      onWarning: vi.fn().mockResolvedValue(undefined),
      onBreach,
    });

    // Advance past the deadline
    await vi.advanceTimersByTimeAsync(deadline + 100);
    await timerPromise;

    // Breach must have been called exactly once, at the deadline
    expect(onBreach).toHaveBeenCalledOnce();
  });

  it('satisfied after warning but before breach: warning fires, breach does not', async () => {
    const onWarning = vi.fn().mockResolvedValue(undefined);
    const onBreach = vi.fn().mockResolvedValue(undefined);
    let satisfied = false;
    const isSatisfied = () => satisfied;

    const timerPromise = runClockTimer(1000, 500, isSatisfied, { onWarning, onBreach });

    // Advance past warning — clock not yet satisfied
    await vi.advanceTimersByTimeAsync(600);
    expect(onWarning).toHaveBeenCalledOnce();

    // Satisfy between warning and breach
    satisfied = true;
    await vi.advanceTimersByTimeAsync(500);
    await timerPromise;

    expect(onBreach).not.toHaveBeenCalled();
  });
});
