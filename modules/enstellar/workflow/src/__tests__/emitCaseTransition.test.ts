import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { emitCaseTransition } from '../activities/emitCaseTransition.js';
import { emitTransitionEvent } from '../activities/emitTransitionEvent.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// emitCaseTransition — delegates to emitTransitionEvent
// ---------------------------------------------------------------------------

describe('emitCaseTransition', () => {
  it('calls the case-service notify endpoint on success (200)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await emitCaseTransition({
      caseId: 'case-001',
      tenantId: 'tenant-abc',
      from: 'intake',
      to: 'completeness_check',
      trigger: 'case.created',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/internal/transitions/notify');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['schema_ref']).toBe('sim.case.lifecycle/CaseStateChanged/v1');
    expect(body['correlation_id']).toBe('case_case-001');
    const payload = body['payload'] as Record<string, unknown>;
    expect(payload['from']).toBe('intake');
    expect(payload['to']).toBe('completeness_check');
    expect(payload['trigger']).toBe('case.created');
  });

  it('resolves when case-service returns 200 on completeness_check→pend_rfi', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      emitCaseTransition({
        caseId: 'case-002',
        tenantId: 'tenant-abc',
        from: 'completeness_check',
        to: 'pend_rfi',
        trigger: 'completeness.gap_found',
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves when case-service returns 200 on pend_rfi→clinical_review', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      emitCaseTransition({
        caseId: 'case-003',
        tenantId: 'tenant-abc',
        from: 'pend_rfi',
        to: 'clinical_review',
        trigger: 'rfi.satisfied',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws when case-service is unreachable (ECONNREFUSED)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      emitCaseTransition({
        caseId: 'case-004',
        tenantId: 'tenant-abc',
        from: 'clinical_review',
        to: 'determined',
        trigger: 'decision.recorded',
      }),
    ).rejects.toThrow();
  });

  it('throws when case-service is unreachable (timeout)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));

    await expect(
      emitCaseTransition({
        caseId: 'case-005',
        tenantId: 'tenant-abc',
        from: 'pend_rfi',
        to: 'determined',
        trigger: 'rfi.deadline_expired',
      }),
    ).rejects.toThrow();
  });

  it('emits x-tenant-id header with the tenantId', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await emitCaseTransition({
      caseId: 'case-006',
      tenantId: 'tenant-xyz',
      from: 'intake',
      to: 'withdrawn',
      trigger: 'member.withdrawal',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-sim-tenant-id']).toBe('tenant-xyz');
  });

  it('throws when case-service returns a 5xx status (e.g. 500)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(
      emitCaseTransition({
        caseId: 'case-007',
        tenantId: 'tenant-abc',
        from: 'completeness_check',
        to: 'clinical_review',
        trigger: 'completeness.complete',
      }),
    ).rejects.toThrow('500');
  });
});

// ---------------------------------------------------------------------------
// emitTransitionEvent — envelope shape
// ---------------------------------------------------------------------------

describe('emitTransitionEvent envelope', () => {
  it('includes a unique event_id (UUID v4 format) on each call', async () => {
    const bodies: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(init?.body as string);
      return new Response(null, { status: 200 });
    });

    await emitTransitionEvent({
      caseId: 'c1',
      tenantId: 't1',
      fromState: 'intake',
      toState: 'completeness_check',
      trigger: 'case.created',
    });
    await emitTransitionEvent({
      caseId: 'c1',
      tenantId: 't1',
      fromState: 'intake',
      toState: 'completeness_check',
      trigger: 'case.created',
    });

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const id1 = (JSON.parse(bodies[0]!) as { event_id: string }).event_id;
    const id2 = (JSON.parse(bodies[1]!) as { event_id: string }).event_id;
    expect(id1).toMatch(uuidRe);
    expect(id2).toMatch(uuidRe);
    expect(id1).not.toBe(id2);
  });

  it('sets actor.type to service and actor.id to enstellar-workflow', async () => {
    let captured: Record<string, unknown> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(null, { status: 200 });
    });

    await emitTransitionEvent({
      caseId: 'c2',
      tenantId: 't2',
      fromState: 'pend_rfi',
      toState: 'clinical_review',
      trigger: 'rfi.satisfied',
    });

    const actor = captured['actor'] as { type: string; id: string };
    expect(actor.type).toBe('service');
    expect(actor.id).toBe('enstellar-workflow');
  });
});
