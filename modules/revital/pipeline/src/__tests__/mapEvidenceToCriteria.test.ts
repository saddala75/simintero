import { describe, it, expect } from 'vitest';
import { mapEvidenceToCriteriaImpl } from '../activities/mapEvidenceToCriteria.js';
import type { ExtractionBlock } from '../activities/extractEntities.js';
import type { RequirementsResult } from '../activities/fetchEvidenceRequirements.js';

const EXTRACTED: ExtractionBlock = {
  status: 'ok',
  resources: [{
    fabric_ref: 'fabric/Procedure/px_1',
    resource_type: 'Procedure',
    provenance_ref: 'trc_1',
    normalization: {
      coded: true,
      source: 'model-hint',
      system: 'CPT',
      code: '97110',
      raw_text: 'ther ex',
      resource_type: 'Procedure',
    },
  }],
};

const REQUIREMENTS: RequirementsResult = {
  requirements: [
    { id: 'req-pt-trial', description: '8 weeks PT', evidence_types: ['Procedure'] },
    { id: 'req-imaging', description: 'MRI report', evidence_types: ['ImagingStudy'] },
  ],
  trace_ref: 'trc_req',
  pins: [],
};

describe('mapEvidenceToCriteria', () => {
  it('marks Procedure requirement satisfied and ImagingStudy requirement as gap', () => {
    const result = mapEvidenceToCriteriaImpl(EXTRACTED, REQUIREMENTS);
    expect(result.satisfied.map(s => s.requirement_id)).toContain('req-pt-trial');
    expect(result.gaps.map(g => g.requirement_id)).toContain('req-imaging');
    expect(result.conflicts).toEqual([]);
    expect(result.status).toBe('ok');
  });

  it('returns abstained when extraction block is abstained', () => {
    const abstained: ExtractionBlock = { status: 'abstained', resources: [] };
    const result = mapEvidenceToCriteriaImpl(abstained, REQUIREMENTS);
    expect(result.status).toBe('abstained');
    expect(result.satisfied).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('returns all requirements as gaps when no matching resources', () => {
    const noMatch: ExtractionBlock = {
      status: 'ok',
      resources: [{ fabric_ref: 'f', resource_type: 'DiagnosticReport', provenance_ref: 'trc', normalization: { coded: true, source: 'model-hint', system: 'LOINC', code: '1234', raw_text: 'x-ray', resource_type: 'DiagnosticReport' } }],
    };
    const result = mapEvidenceToCriteriaImpl(noMatch, REQUIREMENTS);
    expect(result.gaps).toHaveLength(2);
    expect(result.satisfied).toHaveLength(0);
  });
});
