import { describe, it, expect, vi } from 'vitest';
import { handleCaseLifecycleEvent } from '../handlers/CaseLifecycleHandler.js';
import { handleEvidenceEvent } from '../handlers/EvidenceHandler.js';
import { handleQualEvidenceEvent } from '../handlers/QualEvidenceHandler.js';
import type { CaseLifecycleEvent } from '../handlers/CaseLifecycleHandler.js';
import type { EvidenceEvent } from '../handlers/EvidenceHandler.js';
import type { QualEvidenceEvent } from '../handlers/QualEvidenceHandler.js';

// Pool mock that returns different responses for successive calls
function makePool(queryResponses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResponses[callIndex++] ?? { rows: [] })),
  } as any;
}

// IndexClient stub
function makeIndexClient() {
  return { upsert: vi.fn().mockResolvedValue(undefined) };
}

// ─── CaseLifecycleHandler ──────────────────────────────────────────────────

const baseCaseEvent: CaseLifecycleEvent = {
  event_id: 'evt_case_001',
  tenant_id: 'tenant_abc',
  event_type: 'CaseDetermined',
  case_ref: 'case_xyz',
  member_id: 'member_001',
};

describe('handleCaseLifecycleEvent', () => {
  it('indexes a CaseDetermined event — writes idempotency + outbox rows', async () => {
    // SELECT returns no rows (not seen), then subsequent inserts succeed
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(baseCaseEvent, pool, client);

    // query calls: SELECT (idempotency check), INSERT index_event, INSERT outbox
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(client.upsert).toHaveBeenCalledTimes(1);
  });

  it('indexes a CaseClosed event', async () => {
    const event: CaseLifecycleEvent = { ...baseCaseEvent, event_type: 'CaseClosed' };
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(event, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(client.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips non-handled event type (e.g. CaseUpdated) — no DB calls at all', async () => {
    const event: CaseLifecycleEvent = { ...baseCaseEvent, event_type: 'CaseUpdated' };
    const pool = makePool();
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(event, pool, client);

    expect(pool.query).not.toHaveBeenCalled();
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('skips already-seen event — idempotency SELECT returns a row, only 1 query', async () => {
    const pool = makePool([{ rows: [{ '?column?': 1 }] }]); // SELECT returns row
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(baseCaseEvent, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(1); // only the SELECT
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('calls IndexClient.upsert with correct entity_type "case" and entity_id matching case_ref', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(baseCaseEvent, pool, client);

    expect(client.upsert).toHaveBeenCalledOnce();
    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc['entity_type']).toBe('case');
    expect(doc['entity_id']).toBe('case_xyz');
    expect(doc['tenant_id']).toBe('tenant_abc');
    expect(typeof doc['content_hash']).toBe('string');
    expect((doc['content_hash'] as string).length).toBe(64); // SHA-256 hex
    expect((doc['metadata'] as Record<string, string>)['member_id']).toBe('member_001');
  });

  it('propagates error if IndexClient.upsert throws — does not swallow', async () => {
    const pool = makePool([{ rows: [] }]); // SELECT returns nothing (not seen)
    const client = { upsert: vi.fn().mockRejectedValue(new Error('OpenSearch unavailable')) };

    await expect(
      handleCaseLifecycleEvent(baseCaseEvent, pool, client),
    ).rejects.toThrow('OpenSearch unavailable');
  });

  it('emits EntityIndexed outbox message with correct topic and payload', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(baseCaseEvent, pool, client);

    // 3rd call is the outbox INSERT (topic is embedded in SQL string, not a param)
    const outboxCall = pool.query.mock.calls[2] as [string, unknown[]];
    const sql = outboxCall[0];
    const args = outboxCall[1];
    expect(sql).toContain('sim.search.indexed');  // topic embedded in SQL
    expect(args![0]).toBe('tenant_abc');  // tenant_id ($1)
    const payload = JSON.parse(args![1] as string) as Record<string, unknown>;  // payload ($2)
    expect(payload['event_type']).toBe('EntityIndexed');
    expect(payload['entity_type']).toBe('case');
    expect(payload['entity_id']).toBe('case_xyz');
    expect(payload['source_event_id']).toBe('evt_case_001');
  });
});

// ─── EvidenceHandler ──────────────────────────────────────────────────────

const baseEvidenceEvent: EvidenceEvent = {
  event_id: 'evt_doc_001',
  tenant_id: 'tenant_abc',
  event_type: 'DocumentReady',
  doc_id: 'doc_111',
  member_id: 'member_001',
  doc_type: 'clinical_note',
};

describe('handleEvidenceEvent', () => {
  it('indexes a DocumentReady event with correct entity_type "document"', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleEvidenceEvent(baseEvidenceEvent, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(client.upsert).toHaveBeenCalledOnce();

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc['entity_type']).toBe('document');
    expect(doc['entity_id']).toBe('doc_111');
    expect((doc['metadata'] as Record<string, string>)['doc_type']).toBe('clinical_note');
  });

  it('skips non-DocumentReady event types — no DB calls', async () => {
    const event: EvidenceEvent = { ...baseEvidenceEvent, event_type: 'DocumentQuarantined' };
    const pool = makePool();
    const client = makeIndexClient();

    await handleEvidenceEvent(event, pool, client);

    expect(pool.query).not.toHaveBeenCalled();
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('defaults doc_type to "unknown" when not provided', async () => {
    const event: EvidenceEvent = { ...baseEvidenceEvent, doc_type: undefined };
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleEvidenceEvent(event, pool, client);

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect((doc['metadata'] as Record<string, string>)['doc_type']).toBe('unknown');
  });

  it('skips already-seen event (idempotency)', async () => {
    const pool = makePool([{ rows: [{ '?column?': 1 }] }]);
    const client = makeIndexClient();

    await handleEvidenceEvent(baseEvidenceEvent, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('propagates error if IndexClient.upsert throws for document events', async () => {
    const pool = makePool([{ rows: [] }]); // SELECT returns nothing (not seen)
    const client = { upsert: vi.fn().mockRejectedValue(new Error('opensearch down')) };

    await expect(
      handleEvidenceEvent(baseEvidenceEvent, pool, client),
    ).rejects.toThrow('opensearch down');
  });
});

// ─── QualEvidenceHandler ──────────────────────────────────────────────────

const baseQualEvent: QualEvidenceEvent = {
  event_id: 'evt_gap_001',
  tenant_id: 'tenant_abc',
  event_type: 'GapDetected',
  gap_id: 'gap_777',
  measure_ref: 'HEDIS_DM_A1C',
  member_id: 'member_001',
  gap_type: 'open',
};

describe('handleQualEvidenceEvent', () => {
  it('indexes a GapDetected event with correct entity_type "gap"', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleQualEvidenceEvent(baseQualEvent, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(client.upsert).toHaveBeenCalledOnce();

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc['entity_type']).toBe('gap');
    expect(doc['entity_id']).toBe('gap_777');
    const meta = doc['metadata'] as Record<string, string>;
    expect(meta['measure_ref']).toBe('HEDIS_DM_A1C');
    expect(meta['gap_type']).toBe('open');
    expect(meta['member_id']).toBe('member_001');
  });

  it('skips non-GapDetected event types — no DB calls', async () => {
    const event: QualEvidenceEvent = { ...baseQualEvent, event_type: 'GapClosed' };
    const pool = makePool();
    const client = makeIndexClient();

    await handleQualEvidenceEvent(event, pool, client);

    expect(pool.query).not.toHaveBeenCalled();
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('defaults gap_type to "unknown" when not provided', async () => {
    const event: QualEvidenceEvent = { ...baseQualEvent, gap_type: undefined };
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleQualEvidenceEvent(event, pool, client);

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect((doc['metadata'] as Record<string, string>)['gap_type']).toBe('unknown');
  });

  it('skips already-seen gap event (idempotency)', async () => {
    const pool = makePool([{ rows: [{ '?column?': 1 }] }]);
    const client = makeIndexClient();

    await handleQualEvidenceEvent(baseQualEvent, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('propagates error if IndexClient.upsert throws for gap events', async () => {
    const pool = makePool([{ rows: [] }]);
    const client = { upsert: vi.fn().mockRejectedValue(new Error('Index write failed')) };

    await expect(
      handleQualEvidenceEvent(baseQualEvent, pool, client),
    ).rejects.toThrow('Index write failed');
  });
});
