import { describe, it, expect, vi } from 'vitest';
import { writeAiEvidence } from '../writeAiEvidence.js';

function mockClient(memberRow: any) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const query = vi.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params: params ?? [] });
    if (/from\s+ens\.case/i.test(sql)) return { rows: memberRow ? [{ member_ref: memberRow }] : [] };
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
  case_ref: 'case-1',
  document_refs: ['doc-abc'],
  model_binding_ref: 'claude-pa', model_binding_version: '1.0.0',
  extraction: { status: 'ok', resources: [codedResource] },
};

describe('writeAiEvidence', () => {
  it('resolves member_ref then upserts a fabric resource + a Provenance with source=ai-extraction', async () => {
    const { client, calls } = mockClient('pat-001');
    await writeAiEvidence(client, baseInput as any);
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
  });

  it('SKIPS the write when ens.case has no member_ref (degrade-open, no throw)', async () => {
    const { client, calls } = mockClient(null);
    await writeAiEvidence(client, baseInput as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
  });

  it('SKIPS when extraction abstained', async () => {
    const { client, calls } = mockClient('pat-001');
    await writeAiEvidence(client, { ...baseInput, extraction: { status: 'abstained', resources: [] } } as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
  });

  it('skips uncoded resources (only coded become fabric rows)', async () => {
    const { client, calls } = mockClient('pat-001');
    const uncoded = { ...codedResource, normalization: { coded: false, source: 'uncoded', raw_text: 'foo', resource_type: 'Condition' } };
    await writeAiEvidence(client, { ...baseInput, extraction: { status: 'ok', resources: [uncoded] } } as any);
    expect(calls.filter((c) => /insert into fabric\.resource/i.test(c.sql))).toHaveLength(0);
  });
});
