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
});
