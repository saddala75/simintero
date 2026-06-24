import { describe, it, expect, vi } from 'vitest';
import { persistAdvisoryImpl } from '../activities/persistAdvisory.js';

function makePool() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as import('pg').Pool;
  return { pool, client };
}

const BASE = {
  analysis_id: 'ana_1', tenant_id: 'tenant-x', case_ref: 'case_1', document_refs: [], status: 'partial' as const,
  summary: null, extraction: null, completeness: null, triage: null, unprocessed: [],
};

describe('persistAdvisory', () => {
  it('sets the tenant GUC before writing', async () => {
    const { pool, client } = makePool();
    await persistAdvisoryImpl(BASE, pool);
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe('BEGIN');
    expect(calls[1]![0]).toContain('set_config');
    expect(calls[1]![1]).toEqual(['tenant-x']);
  });

  it('upserts revital.analysis with the status + analysis_id', async () => {
    const { pool, client } = makePool();
    await persistAdvisoryImpl({ ...BASE, status: 'partial' }, pool);
    const upsert = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('revital.analysis'));
    expect(upsert).toBeTruthy();
    expect(upsert![1]).toContain('ana_1');
    expect(upsert![1]).toContain('partial');
  });

  it('emits AnalysisCompleted via shared.outbox with the real columns', async () => {
    const { pool, client } = makePool();
    await persistAdvisoryImpl(BASE, pool);
    const outbox = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).includes('shared.outbox'));
    expect(outbox).toBeTruthy();
    expect(outbox![0]).toContain('event_id');
    expect(outbox![0]).toContain('envelope');
    expect(outbox![0]).not.toContain('payload');
    const [eventId, topic, key, envelopeJson] = outbox![1] as string[];
    expect(eventId).toMatch(/^evt_/);
    expect(topic).toBe('sim.ai.interaction');
    expect(key).toBe('case_1');
    const env = JSON.parse(envelopeJson!);
    expect(env.schema_ref).toBe('sim.ai.interaction/AnalysisCompleted/v1');
    expect(env.payload.analysis_id).toBe('ana_1');
  });

  it('emits one EvidenceAdded (sim.evidence) event per coded AI resource — alongside AnalysisCompleted', async () => {
    const { pool, client } = makePool();
    const codedExtraction = {
      status: 'ok',
      resources: [
        {
          resource_type: 'Condition',
          provenance_ref: '01KVV7VTYN0C950YZHQC36JWZP',
          normalization: { coded: true, system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee', raw_text: 'osteoarthritis of knee', resource_type: 'Condition' },
        },
      ],
    };
    await persistAdvisoryImpl(
      { ...BASE, status: 'complete', member_ref: 'pat-001', extraction: codedExtraction as any },
      pool,
    );
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls;

    // the AnalysisCompleted outbox row is still emitted
    const analysisOutbox = calls.find((c) => (c[0] as string).includes('shared.outbox') && (c[1] as any[])[1] === 'sim.ai.interaction');
    expect(analysisOutbox).toBeTruthy();

    // exactly one EvidenceAdded outbox row on sim.evidence
    const evidenceOutbox = calls.filter((c) => (c[0] as string).includes('shared.outbox') && (c[1] as any[])[1] === 'sim.evidence');
    expect(evidenceOutbox).toHaveLength(1);
    const [eventId, topic, key, envelopeJson] = evidenceOutbox[0]![1] as string[];
    expect(eventId).toMatch(/^evt_/);
    expect(topic).toBe('sim.evidence');
    expect(key).toBe('pat-001');
    const env = JSON.parse(envelopeJson!);
    expect(env.schema_ref).toBe('sim.evidence.added/v1');
    expect(env.tenant.tenant_id).toBe('tenant-x');
    expect(env.correlation_id).toBe('case_1');
    expect(env.payload.fabric_ref).toBe('fabric/Condition/ai-ana_1-0');
    expect(env.payload.resource_type).toBe('Condition');
    expect(env.payload.member_ref).toBe('pat-001');
    expect(env.payload.source).toBe('revital_extraction');
    expect(env.payload.classification).toBe('non_standard');
    expect(env.payload.clinical_context.codes).toEqual([{ system: 'http://snomed.info/sct', code: '239873007' }]);
    expect(env.payload.case_ref).toBe('case_1');
  });
});
