import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitBreach } from '../activities/emitBreach.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('emitBreach', () => {
  it('emits ClockBreached event with correct schema_ref', async () => {
    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await emitBreach({ caseId: 'test-case-uuid', tenantId: 't_test', clockType: 'standard' });

    expect(mockFetch).toHaveBeenCalled();

    const body = JSON.parse(
      (mockFetch.mock.calls[0]?.[1]?.body as string) ?? '{}',
    ) as { schema_ref: string };
    expect(body.schema_ref).toBe('sim.clock.ClockBreached/v1');
  });

  it('throws on 5xx so Temporal retry fires', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    await expect(
      emitBreach({ caseId: 'id', tenantId: 't', clockType: 'standard' }),
    ).rejects.toThrow('500');
  });

  it('does not throw on 501 (Phase 1 stub)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
    await expect(
      emitBreach({ caseId: 'id', tenantId: 't', clockType: 'standard' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on 404 (Phase 1 stub)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      emitBreach({ caseId: 'id', tenantId: 't', clockType: 'appeal' }),
    ).resolves.toBeUndefined();
  });

  it('throws when network is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      emitBreach({ caseId: 'id', tenantId: 't', clockType: 'expedited' }),
    ).rejects.toThrow('emitBreach unreachable');
  });

  it('includes correct tenant and case ids in the envelope', async () => {
    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await emitBreach({ caseId: 'case-abc-123', tenantId: 'tenant-xyz', clockType: 'rfi_hold' });

    const body = JSON.parse(
      (mockFetch.mock.calls[0]?.[1]?.body as string) ?? '{}',
    ) as {
      tenant: { tenant_id: string };
      correlation_id: string;
      payload: { case_id: string; clock_type: string };
    };

    expect(body.tenant.tenant_id).toBe('tenant-xyz');
    expect(body.correlation_id).toBe('case_case-abc-123');
    expect(body.payload.case_id).toBe('case-abc-123');
    expect(body.payload.clock_type).toBe('rfi_hold');
  });

  it('POSTs to the notify endpoint', async () => {
    const mockFetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await emitBreach({ caseId: 'c1', tenantId: 't1', clockType: 'standard' });

    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/internal\/transitions\/notify$/);

    const options = mockFetch.mock.calls[0]?.[1];
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
  });
});
