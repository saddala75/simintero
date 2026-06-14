import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitTransitionEvent } from '../activities/emitTransitionEvent.js';

const BASE_INPUT = {
  caseId: 'case-001',
  tenantId: 'tenant-001',
  fromState: 'intake',
  toState: 'completeness_check',
  trigger: 'case.created',
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

it('resolves on 200', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  );
  await expect(emitTransitionEvent(BASE_INPUT)).resolves.toBeUndefined();
});

it('throws on 404 — endpoint must be live', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 404 }),
  );
  await expect(emitTransitionEvent(BASE_INPUT)).rejects.toThrow('case-service returned 404');
});

it('throws on 501 — endpoint must be implemented', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 501 }),
  );
  await expect(emitTransitionEvent(BASE_INPUT)).rejects.toThrow('case-service returned 501');
});

it('throws on 403 — guard error propagates for Temporal retry decision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 403 }),
  );
  await expect(emitTransitionEvent(BASE_INPUT)).rejects.toThrow('case-service returned 403');
});

it('throws on network error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  await expect(emitTransitionEvent(BASE_INPUT)).rejects.toThrow('emitTransitionEvent unreachable');
});

it('sends x-sim-tenant-id header and human_signoff_recorded in payload', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', mockFetch);
  await emitTransitionEvent({ ...BASE_INPUT, humanSignoffRecorded: true });
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['x-sim-tenant-id']).toBe('tenant-001');
  const body = JSON.parse(init.body as string) as { payload: { human_signoff_recorded: boolean } };
  expect(body.payload.human_signoff_recorded).toBe(true);
});
