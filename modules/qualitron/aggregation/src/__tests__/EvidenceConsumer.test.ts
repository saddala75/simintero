import { describe, it, expect, vi } from 'vitest';
import { handleEvidenceEvent } from '../consumers/EvidenceConsumer.js';
import { handleCaseLifecycleEvent } from '../consumers/CaseLifecycleConsumer.js';
import type { EvidenceEvent } from '../consumers/EvidenceConsumer.js';
import type { CaseLifecycleEvent } from '../consumers/CaseLifecycleConsumer.js';

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
    query: vi
      .fn()
      .mockImplementation(() => Promise.resolve(queryResponses[callIndex++] ?? { rows: [] })),
    connect: vi.fn().mockResolvedValue(client),
  } as any;
  pool.__client = client;
  return pool;
}

const baseEvidenceEvent: EvidenceEvent = {
  event_id: 'evt_001',
  event_type: 'DocumentReady',
  tenant_id: 'tenant_abc',
  correlation_id: 'case_xyz',
  doc_id: 'doc_111',
  occurred_at: '2026-06-13T00:00:00Z',
};

const baseCaseEvent: CaseLifecycleEvent = {
  event_id: 'evt_002',
  event_type: 'CaseDetermined',
  tenant_id: 'tenant_abc',
  case_ref: 'case_xyz',
  member_id: 'member_001',
};

describe('handleEvidenceEvent', () => {
  it('skips processing if event is already in the outbox (idempotency)', async () => {
    // The idempotency SELECT now runs on the withTenant client (client.query),
    // reading the canonical envelope column. Make it return a row.
    const pool = makePool();
    pool.__client.query.mockImplementation((sql: string) =>
      /SELECT 1 FROM shared\.outbox/.test(sql)
        ? Promise.resolve({ rows: [{}] }) // already processed
        : Promise.resolve({ rows: [] }),
    );
    await handleEvidenceEvent(baseEvidenceEvent, pool);

    // No idempotency SELECT on the bare pool — it routes through withTenant.
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).toHaveBeenCalledTimes(1);

    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;
    // Idempotency read uses the envelope column with the tenant GUC set (BEGIN/set_config first).
    const select = calls.find((c) => /SELECT 1 FROM shared\.outbox/.test(c[0]))!;
    expect(select).toBeDefined();
    expect(select[0]).toContain("envelope->'payload'->>'source_event_id'");
    expect(select[0]).not.toMatch(/payload->>'source_event_id'/); // not the dropped column
    // SELECT runs after the GUC is set inside the transaction
    expect(calls[0]![0]).toBe('BEGIN');
    expect(calls[1]![0]).toContain('set_config');
    // No outbox INSERT was attempted (skipped)
    expect(calls.some((c) => /INSERT INTO shared\.outbox/.test(c[0]))).toBe(false);
  });

  it('does nothing for DocumentQuarantined events', async () => {
    const pool = makePool([{ rows: [] }]); // not already processed
    const quarantinedEvent: EvidenceEvent = {
      ...baseEvidenceEvent,
      event_type: 'DocumentQuarantined',
    };
    await handleEvidenceEvent(quarantinedEvent, pool);

    // Non-DocumentReady returns before any DB access.
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('emits a canonical EvidenceIndexed outbox envelope for DocumentReady', async () => {
    const pool = makePool(); // idempotency SELECT returns [] (no row) by default
    await handleEvidenceEvent(baseEvidenceEvent, pool);

    // Everything (idempotency SELECT + INSERT) routes through pool.connect -> client.query.
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).toHaveBeenCalledTimes(1);

    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;

    // Idempotency read uses the envelope column inside the tenant transaction.
    const select = calls.find((c) => /SELECT 1 FROM shared\.outbox/.test(c[0]))!;
    expect(select).toBeDefined();
    expect(select[0]).toContain("envelope->'payload'->>'source_event_id'");

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
    expect(insert[0]).not.toContain('payload)'); // no phantom payload column

    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.qual.evidence'); // topic
    expect(params[4]).toBe('tenant_abc'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.qual.evidence/EvidenceIndexed/v1');
    expect((envelope['tenant'] as Record<string, unknown>)['tenant_id']).toBe('tenant_abc');
    expect(envelope['correlation_id']).toBe('case_xyz');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['event_type']).toBe('EvidenceIndexed');
    expect(payload['source_event_id']).toBe('evt_001');
    expect(payload['doc_id']).toBe('doc_111');
    expect(payload['case_ref']).toBe('case_xyz');

    // commits
    expect(calls.some((c) => c[0] === 'COMMIT')).toBe(true);
  });
});

describe('handleCaseLifecycleEvent', () => {
  it('ignores non-CaseDetermined events', async () => {
    const pool = makePool();
    const openedEvent: CaseLifecycleEvent = {
      ...baseCaseEvent,
      event_type: 'CaseOpened',
    };
    await handleCaseLifecycleEvent(openedEvent, pool);

    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('emits a canonical MemberEligibilityCheck outbox envelope for CaseDetermined', async () => {
    const pool = makePool();
    await handleCaseLifecycleEvent(baseCaseEvent, pool);

    // Outbox INSERT routes through pool.connect -> client.query (withTenant).
    expect(pool.connect).toHaveBeenCalledTimes(1);

    const calls = pool.__client.query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls[0]![0]).toBe('BEGIN');
    const setConfig = calls[1]!;
    expect(setConfig[0]).toContain('set_config');
    expect(setConfig[0]).toContain('sim.tenant_id');
    expect(setConfig[1]).toEqual(['tenant_abc']);

    const insert = calls.find((c) => /INSERT INTO shared\.outbox/.test(c[0]))!;
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('envelope');
    expect(insert[0]).not.toContain('payload)'); // no phantom payload column

    const params = insert[1] as unknown[];
    expect(params[1]).toBe('sim.qual.eligibility'); // topic
    expect(params[4]).toBe('tenant_abc'); // tenant_id
    const envelope = JSON.parse(params[3] as string) as Record<string, unknown>;
    expect(envelope['schema_ref']).toBe('sim.qual.eligibility/MemberEligibilityCheck/v1');
    expect(envelope['correlation_id']).toBe('member_001');
    const payload = envelope['payload'] as Record<string, unknown>;
    expect(payload['event_type']).toBe('MemberEligibilityCheck');
    expect(payload['source_event_id']).toBe('evt_002');
    expect(payload['member_id']).toBe('member_001');
    expect(payload['case_ref']).toBe('case_xyz');

    expect(calls.some((c) => c[0] === 'COMMIT')).toBe(true);
  });
});
