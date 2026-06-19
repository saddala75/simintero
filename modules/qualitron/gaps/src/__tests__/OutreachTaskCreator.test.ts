import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOutreachTask } from '../OutreachTaskCreator.js';
import type { OutreachTaskInput } from '../OutreachTaskCreator.js';

const TASK_SERVICE_URL = 'http://task-service.internal';

const INPUT: OutreachTaskInput = {
  tenant_id: 'tenant_abc',
  gap_id: 'gap_001',
  member_id: 'mem_001',
  measure_ref: 'hedis:BCS-E',
  period_start: '2024-01-01',
  period_end: '2024-12-31',
};

describe('createOutreachTask', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends x-sim-tenant-id header set to input.tenant_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'task_abc123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createOutreachTask(INPUT, TASK_SERVICE_URL);

    expect(result).toEqual({ task_id: 'task_abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TASK_SERVICE_URL}/v1/tasks`);
    expect((init.headers as Record<string, string>)['x-sim-tenant-id']).toBe(INPUT.tenant_id);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends the expected task payload body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'task_abc123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createOutreachTask(INPUT, TASK_SERVICE_URL);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      task_kind: 'quality-outreach',
      member_id: INPUT.member_id,
      measure_ref: INPUT.measure_ref,
      gap_id: INPUT.gap_id,
      period: { start: INPUT.period_start, end: INPUT.period_end },
    });
  });

  it('returns null on non-2xx response (null-degrade preserved)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));

    const result = await createOutreachTask(INPUT, TASK_SERVICE_URL);
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (catch-degrade preserved)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await createOutreachTask(INPUT, TASK_SERVICE_URL);
    expect(result).toBeNull();
  });
});
