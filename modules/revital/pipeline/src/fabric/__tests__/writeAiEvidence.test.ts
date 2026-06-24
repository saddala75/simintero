import { describe, it, expect, vi } from 'vitest';
import { writeAiEvidence } from '../writeAiEvidence.js';

function mockClient() {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const query = vi.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params: params ?? [] });
    return { rows: [] };
  });
  return { client: { query } as any, calls };
}

const codedResource = {
  fabric_ref: 'fabric/Condition/extracted_0',
  resource_type: 'Condition',
  provenance_ref: '01KVV7VTYN0C950YZHQC36JWZP',
  normalization: { coded: true, system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee', raw_text: 'osteoarthritis of knee', resource_type: 'Condition', source: 'text-search' },
};
const baseInput = {
  analysis_id: 'an_123',
  member_ref: 'pat-001',
  document_refs: ['doc-abc'],
  model_binding_ref: 'claude-pa', model_binding_version: '1.0.0',
  extraction: { status: 'ok', resources: [codedResource] },
};

describe('writeAiEvidence', () => {
  it('upserts a fabric resource + a Provenance with source=ai-extraction when member_ref is given, and RETURNS the descriptor', async () => {
    const { client, calls } = mockClient();
    const written = await writeAiEvidence(client, baseInput as any);
    const inserts = calls.filter((c) => /insert into fabric\.resource/i.test(c.sql));
    expect(inserts).toHaveLength(2); // resource + provenance
    // every fabric write tags source='ai-extraction' and carries the request_id provenance_ref
    for (const ins of inserts) {
      expect(ins.params).toContain('ai-extraction');
      expect(ins.params).toContain('01KVV7VTYN0C950YZHQC36JWZP');
    }
    const types = inserts.map((c) => c.params[0]);
    expect(types).toContain('Condition');
    expect(types).toContain('Provenance');
    // returns one descriptor of what it wrote
    expect(written).toEqual([
      {
        fabric_ref: 'fabric/Condition/ai-an_123-0',
        resource_type: 'Condition',
        member_ref: 'pat-001',
        provenance_ref: '01KVV7VTYN0C950YZHQC36JWZP',
        codes: [{ system: 'http://snomed.info/sct', code: '239873007' }],
      },
    ]);
  });

  it('SKIPS the write when no member_ref is provided (degrade-open, no throw) and returns []', async () => {
    const { client, calls } = mockClient();
    const { member_ref: _omit, ...noMember } = baseInput;
    const written = await writeAiEvidence(client, noMember as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
    expect(written).toEqual([]);
  });

  it('SKIPS when extraction abstained and returns []', async () => {
    const { client, calls } = mockClient();
    const written = await writeAiEvidence(client, { ...baseInput, extraction: { status: 'abstained', resources: [] } } as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
    expect(written).toEqual([]);
  });

  it('skips uncoded resources (only coded become fabric rows) and returns []', async () => {
    const { client, calls } = mockClient();
    const uncoded = { ...codedResource, normalization: { coded: false, source: 'uncoded', raw_text: 'foo', resource_type: 'Condition' } };
    const written = await writeAiEvidence(client, { ...baseInput, extraction: { status: 'ok', resources: [uncoded] } } as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
    expect(written).toEqual([]);
  });
});
