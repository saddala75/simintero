import { describe, it, expect } from 'vitest';
import { buildFabricResource } from '../buildFabricResource.js';

const base = {
  fhir_id: 'ai-an_123-0',
  system: 'http://snomed.info/sct',
  code: '239873007',
  display: 'Osteoarthritis of knee',
  raw_text: 'osteoarthritis of knee',
  member_ref: 'pat-001',
};

describe('buildFabricResource', () => {
  it('builds a Condition with coding + text + subject + clinicalStatus', () => {
    const r = buildFabricResource({ ...base, resource_type: 'Condition' });
    expect(r).toMatchObject({
      resourceType: 'Condition',
      id: 'ai-an_123-0',
      subject: { reference: 'Patient/pat-001' },
      code: { coding: [{ system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' }], text: 'osteoarthritis of knee' },
    });
    expect(r.clinicalStatus.coding[0].code).toBe('active');
  });

  it('builds an Observation with status=final', () => {
    const r = buildFabricResource({ ...base, resource_type: 'Observation' });
    expect(r.resourceType).toBe('Observation');
    expect(r.status).toBe('final');
    expect(r.code.coding[0].code).toBe('239873007');
  });

  it('builds a Procedure with status=completed', () => {
    const r = buildFabricResource({ ...base, resource_type: 'Procedure' });
    expect(r.resourceType).toBe('Procedure');
    expect(r.status).toBe('completed');
  });

  it('omits coding.display when display is undefined', () => {
    const r = buildFabricResource({ ...base, display: undefined, resource_type: 'Condition' });
    expect(r.code.coding[0]).not.toHaveProperty('display');
    expect(r.code.coding[0].code).toBe('239873007');
  });

  it('falls back to a generic resource for unknown types (coding + subject preserved)', () => {
    const r = buildFabricResource({ ...base, resource_type: 'AllergyIntolerance' });
    expect(r.resourceType).toBe('AllergyIntolerance');
    expect(r.subject).toEqual({ reference: 'Patient/pat-001' });
    expect(r.code.coding[0].code).toBe('239873007');
  });
});
