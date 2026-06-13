import { describe, it, expect, vi } from 'vitest';
import { persistAdvisoryImpl } from '../activities/persistAdvisory.js';

function makePool(): import('pg').Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as import('pg').Pool;
}

describe('persistAdvisory', () => {
  it('upserts revital.analysis row with correct status and analysis_id', async () => {
    const pool = makePool();
    await persistAdvisoryImpl({
      analysis_id: 'ana_1',
      case_ref: 'case_1',
      status: 'complete',
      summary: { status: 'ok', abstain_reason: null, assertions: [] },
      extraction: null,
      completeness: null,
      triage: null,
      unprocessed: [],
    }, pool);

    const upsertCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => (call[0] as string).includes('revital.analysis'));
    expect(upsertCall).toBeTruthy();
    expect(upsertCall![1]).toContain('ana_1');
    expect(upsertCall![1]).toContain('complete');
  });

  it('emits AnalysisCompleted event via shared.outbox', async () => {
    const pool = makePool();
    await persistAdvisoryImpl({
      analysis_id: 'ana_1',
      case_ref: 'case_1',
      status: 'complete',
      summary: null,
      extraction: null,
      completeness: null,
      triage: null,
      unprocessed: [],
    }, pool);

    const outboxCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => (call[0] as string).includes('shared.outbox'));
    expect(outboxCall).toBeTruthy();
    const payload = JSON.parse(outboxCall![1]![1] as string);
    expect(payload.event_type).toBe('AnalysisCompleted');
    expect(payload.analysis_id).toBe('ana_1');
  });

  it('stores unprocessed documents in the record', async () => {
    const pool = makePool();
    await persistAdvisoryImpl({
      analysis_id: 'ana_2',
      case_ref: 'case_2',
      status: 'partial',
      summary: null,
      extraction: null,
      completeness: null,
      triage: null,
      unprocessed: [{ ref: 'd1', reason: 'quarantined' }],
    }, pool);

    const upsertCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => (call[0] as string).includes('revital.analysis'));
    const params = upsertCall![1] as unknown[];
    const unprocessedJson = params.find(p => typeof p === 'string' && (p as string).includes('quarantined'));
    expect(unprocessedJson).toBeTruthy();
  });
});
