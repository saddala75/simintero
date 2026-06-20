import { describe, it, expect, vi } from 'vitest';
import { handleCaseLifecycleEvent } from '../handlers/CaseLifecycleHandler.js';
import { handleEvidenceEvent } from '../handlers/EvidenceHandler.js';
import { handleQualEvidenceEvent } from '../handlers/QualEvidenceHandler.js';
import type { CaseLifecycleEvent } from '../handlers/CaseLifecycleHandler.js';
import type { EvidenceEvent } from '../handlers/EvidenceHandler.js';
import type { QualEvidenceEvent } from '../handlers/QualEvidenceHandler.js';

// Pool mock that returns different responses for successive pool.query calls.
// pool.connect() yields a client whose query() is used by withTenant + appendEvent
// for the canonical outbox INSERT (BEGIN / set_config / INSERT / COMMIT).
function makePool(queryResponses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResponses[callIndex++] ?? { rows: [] })),
    connect: vi.fn().mockResolvedValue(client),
  } as any;
  pool.__client = client;
  return pool;
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

    // pool.query: SELECT (idempotency check), INSERT index_event.
    // Outbox INSERT is routed through pool.connect -> client.query (withTenant).
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.upsert).toHaveBeenCalledTimes(1);
  });

  it('indexes a CaseClosed event', async () => {
    const event: CaseLifecycleEvent = { ...baseCaseEvent, event_type: 'CaseClosed' };
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(event, pool, client);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.connect).toHaveBeenCalledTimes(1);
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

  it('emits a canonical outbox envelope via withTenant + appendEvent', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleCaseLifecycleEvent(baseCaseEvent, pool, client);

    const dbClient = pool.__client;
    const calls = dbClient.query.mock.calls as Array<[string, unknown[]?]>;

    // withTenant opens a transaction and sets the RLS GUC on the same client
    expect(calls[0]![0]).toBe('BEGIN');
    const setConfig = calls[1]!;
    expect(setConfig[0]).toContain('set_config');
    expect(setConfig[0]).toContain('sim.tenant_id');
    expect(setConfig[1]).toEqual(['tenant_abc']);

    // canonical 5-column INSERT (event_id, topic, key, envelope, tenant_id) — no payload column
    const insert = calls.find((c) => /INSERT INTO shared\.outbox/.test(c[0]))!;
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('event_id');
    expect(insert[0]).toContain('topic');
    expect(insert[0]).toContain('key');
    expect(insert[0]).toContain('envelope');
    expect(insert[0]).toContain('tenant_id');
    expect(insert[0]).not.toContain('payload');

    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.search.indexed'); // topic
    expect(params[4]).toBe('tenant_abc'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.search.indexed/CaseIndexed/v1');
    expect((envelope['tenant'] as Record<string, unknown>)['tenant_id']).toBe('tenant_abc');
    expect(envelope['correlation_id']).toBe('case_xyz');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['event_type']).toBe('EntityIndexed');
    expect(payload['entity_type']).toBe('case');
    expect(payload['entity_id']).toBe('case_xyz');
    expect(payload['source_event_id']).toBe('evt_case_001');

    // commits
    expect(calls.some((c) => c[0] === 'COMMIT')).toBe(true);
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

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.upsert).toHaveBeenCalledOnce();

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc['entity_type']).toBe('document');
    expect(doc['entity_id']).toBe('doc_111');
    expect((doc['metadata'] as Record<string, string>)['doc_type']).toBe('clinical_note');
  });

  it('emits a canonical outbox envelope via withTenant + appendEvent', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleEvidenceEvent(baseEvidenceEvent, pool, client);

    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;
    const setConfig = calls.find((c) => /set_config/.test(c[0]))!;
    expect(setConfig[1]).toEqual(['tenant_abc']);

    const insert = calls.find((c) => /INSERT INTO shared\.outbox/.test(c[0]))!;
    expect(insert[0]).toContain('envelope');
    expect(insert[0]).not.toContain('payload)'); // no phantom payload column
    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.search.indexed');
    expect(params[4]).toBe('tenant_abc');
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.search.indexed/EvidenceIndexed/v1');
    expect(envelope['correlation_id']).toBe('doc_111');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['entity_type']).toBe('document');
    expect(payload['entity_id']).toBe('doc_111');
    expect(payload['source_event_id']).toBe('evt_doc_001');
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

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.upsert).toHaveBeenCalledOnce();

    const doc = client.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(doc['entity_type']).toBe('gap');
    expect(doc['entity_id']).toBe('gap_777');
    const meta = doc['metadata'] as Record<string, string>;
    expect(meta['measure_ref']).toBe('HEDIS_DM_A1C');
    expect(meta['gap_type']).toBe('open');
    expect(meta['member_id']).toBe('member_001');
  });

  it('emits a canonical outbox envelope via withTenant + appendEvent', async () => {
    const pool = makePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const client = makeIndexClient();

    await handleQualEvidenceEvent(baseQualEvent, pool, client);

    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;
    const setConfig = calls.find((c) => /set_config/.test(c[0]))!;
    expect(setConfig[1]).toEqual(['tenant_abc']);

    const insert = calls.find((c) => /INSERT INTO shared\.outbox/.test(c[0]))!;
    expect(insert[0]).toContain('envelope');
    expect(insert[0]).not.toContain('payload)'); // no phantom payload column
    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.search.indexed');
    expect(params[4]).toBe('tenant_abc');
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.search.indexed/QualEvidenceIndexed/v1');
    expect(envelope['correlation_id']).toBe('gap_777');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['entity_type']).toBe('gap');
    expect(payload['entity_id']).toBe('gap_777');
    expect(payload['source_event_id']).toBe('evt_gap_001');
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
