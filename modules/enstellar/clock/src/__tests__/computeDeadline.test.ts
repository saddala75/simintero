import { describe, it, expect } from 'vitest';
import { computeDeadline } from '../activities/computeDeadline.js';

describe('computeDeadline', () => {
  it('14 business days from 2026-01-01 = 2026-01-21', () => {
    // Jan 1 (Thu) → count starts after it
    // Jan 2(F)=1, Jan 5(M)=2, Jan 6(T)=3, Jan 7(W)=4, Jan 8(Th)=5,
    // Jan 9(F)=6, Jan 12(M)=7, Jan 13(T)=8, Jan 14(W)=9, Jan 15(Th)=10,
    // Jan 16(F)=11, Jan 19(M)=12, Jan 20(T)=13, Jan 21(W)=14
    const start = new Date('2026-01-01T00:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 14, unit: 'business_days' },
    });
    expect(result.toISOString().startsWith('2026-01-21')).toBe(true);
  });

  it('72 hours from 2026-01-01 = 2026-01-04', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 72, unit: 'hours' },
    });
    expect(result.toISOString().startsWith('2026-01-04')).toBe(true);
  });

  it('60 calendar days from 2026-01-01 = 2026-03-02', () => {
    // Jan: 31 days, Feb 2026: 28 days (not a leap year)
    // Jan 1 + 60d = Jan 1 + 31 (rest of Jan) - 1 + 28 (Feb) + 1 (Mar 1) → Mar 2
    const start = new Date('2026-01-01T00:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 60, unit: 'calendar_days' },
    });
    expect(result.toISOString().startsWith('2026-03-02')).toBe(true);
  });

  it('0 business days from any date = same date', () => {
    const start = new Date('2026-06-01T00:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 0, unit: 'business_days' },
    });
    expect(result.getTime()).toBe(start.getTime());
  });

  it('business days skip weekends', () => {
    // 2026-01-02 is Friday; +1 business day = 2026-01-05 (Monday)
    const friday = new Date('2026-01-02T00:00:00Z');
    const result = computeDeadline({
      startedAt: friday,
      limitValue: { value: 1, unit: 'business_days' },
    });
    expect(result.toISOString().startsWith('2026-01-05')).toBe(true);
  });

  it('0 hours = same timestamp', () => {
    const start = new Date('2026-06-01T12:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 0, unit: 'hours' },
    });
    expect(result.getTime()).toBe(start.getTime());
  });

  it('0 calendar days = same timestamp', () => {
    const start = new Date('2026-06-01T12:00:00Z');
    const result = computeDeadline({
      startedAt: start,
      limitValue: { value: 0, unit: 'calendar_days' },
    });
    expect(result.getTime()).toBe(start.getTime());
  });
});
