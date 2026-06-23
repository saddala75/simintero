import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../buildProvenance.js';

const args = {
  provenance_fhir_id: 'prov-ai-an_123-0',
  target_resource_type: 'Condition',
  target_fhir_id: 'ai-an_123-0',
  request_id: '01KVV7VTYN0C950YZHQC36JWZP',
  document_refs: ['doc-abc', 'doc-def'],
  model_agent: 'claude-pa@1.0.0',
};

describe('buildProvenance', () => {
  it('builds a Provenance targeting the resource with the request_id extension', () => {
    const p = buildProvenance(args);
    expect(p.resourceType).toBe('Provenance');
    expect(p.id).toBe('prov-ai-an_123-0');
    expect(p.target).toEqual([{ reference: 'Condition/ai-an_123-0' }]);
    const ext = p.extension.find((e: any) => e.url.endsWith('/ai-request-id'));
    expect(ext.valueString).toBe('01KVV7VTYN0C950YZHQC36JWZP');
  });

  it('lists one source entity per document_ref', () => {
    const p = buildProvenance(args);
    expect(p.entity.map((e: any) => e.what.reference)).toEqual([
      'DocumentReference/doc-abc',
      'DocumentReference/doc-def',
    ]);
    expect(p.entity[0].role).toBe('source');
  });

  it('uses the model_agent as agent.who.display', () => {
    const p = buildProvenance(args);
    expect(p.agent[0].who.display).toBe('claude-pa@1.0.0');
    expect(p.agent[0].type.text).toBe('ai-extraction');
  });

  it('falls back to a generic agent display when model_agent is absent', () => {
    const p = buildProvenance({ ...args, model_agent: undefined });
    expect(p.agent[0].who.display).toBe('ai-extraction');
  });
});
