import { describe, it, expect, vi } from 'vitest';
import { evaluateMeasure, type MeasureSpec } from '../activities/evaluateMeasure.js';

const SPEC: MeasureSpec = {
  denominator: { resource_type: 'Patient' },
  numerator: { resource_type: 'Observation', code: '24604-1' },
  exclusion: { resource_type: 'Condition', code: 'hospice' },
};

describe('evaluateMeasure (self-contained over fabric)', () => {
  it('numerator=true when the member has the required Observation', async () => {
    // 1st query (numerator) → a match; 2nd (exclusion) → none
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ fhir_id: 'obs-001' }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await evaluateMeasure(
      { query } as any,
      'member-001',
      'hedis:BCS-E',
      SPEC,
      '2026-01-01',
      '2026-06-30',
    );
    expect(r.numerator).toBe(true);
    expect(r.denominator).toBe(true);
    expect(r.exclusion).toBe(false);
    expect(r.evidence_refs).toEqual(['obs-001']);
    // the numerator query reads content->'code'->'coding'->0->>'code'
    expect(query.mock.calls[0]?.[0] as string).toMatch(/content->'code'->'coding'->0->>'code'/);
  });

  it('numerator=false (gap) when no matching Observation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const r = await evaluateMeasure(
      { query } as any,
      'member-003',
      'hedis:BCS-E',
      SPEC,
      '2026-01-01',
      '2026-06-30',
    );
    expect(r.numerator).toBe(false);
    expect(r.denominator).toBe(true);
  });

  it('exclusion=true when an exclusion resource matches', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // numerator none
      .mockResolvedValueOnce({ rows: [{ fhir_id: 'cond-x' }] }); // exclusion match
    const r = await evaluateMeasure(
      { query } as any,
      'member-x',
      'hedis:BCS-E',
      SPEC,
      '2026-01-01',
      '2026-06-30',
    );
    expect(r.exclusion).toBe(true);
  });
});
