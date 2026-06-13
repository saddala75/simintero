import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { handleEvidenceEvent } from '../consumers/EvidenceConsumer.js';
import { handleCaseLifecycleEvent } from '../consumers/CaseLifecycleConsumer.js';
import type { EvidenceEvent } from '../consumers/EvidenceConsumer.js';
import type { CaseLifecycleEvent } from '../consumers/CaseLifecycleConsumer.js';

function makePool(rows: Record<string, unknown>[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
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
    const pool = makePool([{}]); // SELECT returns a row — already processed
    await handleEvidenceEvent(baseEvidenceEvent, pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1); // only the SELECT, no INSERT
    expect(queryMock.mock.calls[0]![0]).toContain('SELECT 1');
  });

  it('does nothing for DocumentQuarantined events', async () => {
    const pool = makePool([]); // not already processed
    const quarantinedEvent: EvidenceEvent = {
      ...baseEvidenceEvent,
      event_type: 'DocumentQuarantined',
    };
    await handleEvidenceEvent(quarantinedEvent, pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    // SELECT runs (idempotency check), but no INSERT
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]![0]).toContain('SELECT 1');
  });

  it('emits EvidenceIndexed outbox event for DocumentReady', async () => {
    const pool = makePool([]); // not already processed
    await handleEvidenceEvent(baseEvidenceEvent, pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(2);

    const [, insertArgs] = queryMock.mock.calls[1]! as [string, unknown[]];
    expect(insertArgs![0]).toBe('tenant_abc'); // tenant_id
    expect(insertArgs![1]).toBe('sim.qual.evidence'); // topic
    const payload = JSON.parse(insertArgs![2] as string) as Record<string, unknown>;
    expect(payload['event_type']).toBe('EvidenceIndexed');
    expect(payload['source_event_id']).toBe('evt_001');
    expect(payload['doc_id']).toBe('doc_111');
    expect(payload['case_ref']).toBe('case_xyz');
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

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('emits MemberEligibilityCheck outbox event for CaseDetermined', async () => {
    const pool = makePool();
    await handleCaseLifecycleEvent(baseCaseEvent, pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1);

    const [, insertArgs] = queryMock.mock.calls[0]! as [string, unknown[]];
    expect(insertArgs![0]).toBe('tenant_abc'); // tenant_id
    expect(insertArgs![1]).toBe('sim.qual.eligibility'); // topic
    const payload = JSON.parse(insertArgs![2] as string) as Record<string, unknown>;
    expect(payload['event_type']).toBe('MemberEligibilityCheck');
    expect(payload['source_event_id']).toBe('evt_002');
    expect(payload['member_id']).toBe('member_001');
    expect(payload['case_ref']).toBe('case_xyz');
  });
});
