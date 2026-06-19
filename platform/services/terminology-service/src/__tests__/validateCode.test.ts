import { describe, it, expect } from 'vitest';
import { validateCode } from '../validateCode.js';
import { expand } from '../expand.js';
import type { FhirValueSet } from '../vkas.js';

const VS: FhirValueSet = {
  resourceType: 'ValueSet',
  url: 'http://example.org/vs/x',
  expansion: {
    contains: [
      { system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' },
      { system: 'http://snomed.info/sct', code: '30989003', display: 'Knee pain' },
    ],
  },
};

describe('validateCode', () => {
  it('unresolved value-set → resolved:false, result:false', () => {
    expect(validateCode(null)).toEqual({ resolved: false, result: false });
  });

  it('resolved + no code → resolvability probe result:true', () => {
    expect(validateCode(VS)).toEqual({ resolved: true, result: true });
  });

  it('member code → result:true with display', () => {
    expect(validateCode(VS, 'http://snomed.info/sct', '239873007')).toEqual({
      resolved: true, result: true, display: 'Osteoarthritis of knee',
    });
  });

  it('non-member code → result:false', () => {
    expect(validateCode(VS, 'http://snomed.info/sct', '000000')).toEqual({ resolved: true, result: false });
  });

  it('member code but wrong system → result:false', () => {
    expect(validateCode(VS, 'http://loinc.org', '239873007')).toEqual({ resolved: true, result: false });
  });

  it('member code with no system given → matches on code alone', () => {
    expect(validateCode(VS, undefined, '30989003')).toEqual({
      resolved: true, result: true, display: 'Knee pain',
    });
  });
});

describe('expand', () => {
  it('null → null', () => {
    expect(expand(null)).toBeNull();
  });
  it('resolved → returns the value-set', () => {
    expect(expand(VS)).toEqual(VS);
  });
});
