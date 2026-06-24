import { describe, it, expect } from 'vitest';
import { mapEvidenceToCriteriaImpl } from '../mapEvidenceToCriteria.js';

const reqs = (requirements: any[]) => ({ requirements, trace_ref: 'tr-1', pins: [] });
const coded = (resource_type: string, system: string, code: string, i = 0) => ({
  fabric_ref: `Condition/ai-an-${i}`, resource_type, provenance_ref: `01PROV${i}`,
  normalization: { coded: true, system, code, display: 'd', raw_text: 't', resource_type, source: 'text-search' },
});
const SNO = 'http://snomed.info/sct';

describe('mapEvidenceToCriteria (code-aware)', () => {
  it('SATISFIES by {system,code} affirmer and cites fabric_ref + provenance_ref', () => {
    const out = mapEvidenceToCriteriaImpl(
      { status: 'ok', resources: [coded('Condition', SNO, '239873007')] } as any,
      reqs([{ id: 'diagnosis_documented', description: 'dx', required: true, evidence_types: ['Condition'],
              codes: [{ system: SNO, code: '239873007' }], negates: [{ system: SNO, code: '30989003' }] }]) as any,
    );
    expect(out.satisfied).toHaveLength(1);
    expect(out.satisfied[0]!.requirement_id).toBe('diagnosis_documented');
    expect(out.satisfied[0]!.evidence_refs).toEqual(['Condition/ai-an-0', '01PROV0']);
    expect(out.conflicts).toEqual([]);
  });

  it('GAPS a required requirement with no matching evidence', () => {
    const out = mapEvidenceToCriteriaImpl(
      { status: 'ok', resources: [] } as any,
      reqs([{ id: 'imaging_documented', description: 'img', required: true, evidence_types: ['Observation'], codes: [{ system: 'http://loinc.org', code: '24604-1' }] }]) as any,
    );
    expect(out.gaps.map((g) => g.requirement_id)).toEqual(['imaging_documented']);
    expect(out.satisfied).toEqual([]);
  });

  it('flags NEGATION when a negater code is present (and not a gap)', () => {
    const out = mapEvidenceToCriteriaImpl(
      { status: 'ok', resources: [coded('Condition', SNO, '30989003')] } as any,
      reqs([{ id: 'diagnosis_documented', description: 'dx', required: true, evidence_types: ['Condition'],
              codes: [{ system: SNO, code: '239873007' }], negates: [{ system: SNO, code: '30989003' }] }]) as any,
    );
    expect(out.conflicts.some((c) => c.kind === 'negation')).toBe(true);
    expect(out.gaps).toEqual([]);          // contradicted, not absent
    expect(out.satisfied).toEqual([]);
  });

  it('flags CONTRADICTION when affirmer AND negater both present (also satisfied)', () => {
    const out = mapEvidenceToCriteriaImpl(
      { status: 'ok', resources: [coded('Condition', SNO, '239873007', 0), coded('Condition', SNO, '30989003', 1)] } as any,
      reqs([{ id: 'diagnosis_documented', description: 'dx', required: true, evidence_types: ['Condition'],
              codes: [{ system: SNO, code: '239873007' }], negates: [{ system: SNO, code: '30989003' }] }]) as any,
    );
    expect(out.satisfied).toHaveLength(1);
    expect(out.conflicts.map((c) => c.kind).sort()).toEqual(['contradiction', 'negation']);
    const contra = out.conflicts.find((c) => c.kind === 'contradiction')!;
    expect(contra.refs).toEqual(expect.arrayContaining(['Condition/ai-an-0', 'Condition/ai-an-1']));
  });

  it('un-enriched requirement (no codes/negates) falls back to resource_type match, no conflicts', () => {
    const out = mapEvidenceToCriteriaImpl(
      { status: 'ok', resources: [coded('Procedure', 'CPT', '97110')] } as any,
      reqs([{ id: 'pt', description: 'pt', required: true, evidence_types: ['Procedure'] }]) as any,
    );
    expect(out.satisfied.map((s) => s.requirement_id)).toEqual(['pt']);
    expect(out.conflicts).toEqual([]);
  });

  it('abstained extraction → all empty', () => {
    const out = mapEvidenceToCriteriaImpl({ status: 'abstained', resources: [] } as any, reqs([]) as any);
    expect(out).toMatchObject({ status: 'abstained', satisfied: [], gaps: [], conflicts: [] });
  });
});
