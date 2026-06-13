import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callRuntimeEvaluate } from '../activities/callRuntimeEvaluate.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('callRuntimeEvaluate', () => {
  it('returns stub response when C-1 returns 501', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 501 }),
    );

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    expect(result.eligible).toBe(false);
    expect(result.gaps).toEqual([]);
    expect(result.pins).toEqual([]);
  });

  it('returns stub response when C-1 returns 503', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
    );

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    expect(result.eligible).toBe(false);
    expect(result.pins).toEqual([]);
  });

  it('returns stub response on connection error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    expect(result.eligible).toBe(false);
    expect(result.pins).toEqual([]);
  });

  it('returns evaluate result when C-1 responds 200 with eligible=true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          eligible: true,
          gaps: [],
          pins: [{ canonical_url: 'https://artifacts.simintero.io/policy/knee-arthroscopy', version: '1.0' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    expect(result.eligible).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.pins).toHaveLength(1);
    expect(result.pins[0]?.canonical_url).toBe(
      'https://artifacts.simintero.io/policy/knee-arthroscopy',
    );
  });

  it('returns evaluate result when C-1 responds 200 with gaps', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          eligible: false,
          gaps: ['missing_auth_letter', 'incomplete_clinical_notes'],
          pins: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    expect(result.eligible).toBe(false);
    expect(result.gaps).toEqual(['missing_auth_letter', 'incomplete_clinical_notes']);
  });

  it('throws on unexpected 4xx error from C-1', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    await expect(
      callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] }),
    ).rejects.toThrow('C-1 evaluate failed with status 400');
  });

  it('persists pins when C-1 returns them (pin persistence is non-fatal)', async () => {
    // First fetch call: C-1 evaluate returning pins
    // Second fetch call: case-service responds 404 (case not found — non-retriable, non-fatal)
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ eligible: true, gaps: [], pins: [{ canonical_url: 'x', version: '1' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const result = await callRuntimeEvaluate({ caseId: 'test-case', policyRefs: [] });

    // Should still succeed despite pin persistence returning 404
    expect(result.eligible).toBe(true);
    expect(result.pins).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('callRuntimeEvaluate - persistPins retry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('persists pins on first attempt when case-service responds 200', async () => {
    const mockFetch = vi.mocked(fetch);
    // First call: runtime evaluate → returns pins
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ eligible: true, gaps: [], pins: [{ canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0', version: '1.0.0' }] }),
    } as Response);
    // Second call: persistPins → 200
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response);

    const result = await callRuntimeEvaluate({ caseId: 'c_001', policyRefs: [] });
    expect(result.pins).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries persistPins on 500 then succeeds on second attempt', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.mocked(fetch);
    // Runtime evaluate
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ eligible: true, gaps: [], pins: [{ canonical_url: 'urn:sim:policy:x:1.0', version: '1.0' }] }),
    } as Response);
    // persistPins attempt 1: 500
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    // persistPins attempt 2: 200
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const promise = callRuntimeEvaluate({ caseId: 'c_002', policyRefs: [] });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.eligible).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not throw when persistPins fails all 3 attempts', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ eligible: false, gaps: ['missing_imaging'], pins: [{ canonical_url: 'urn:x', version: '1' }] }),
    } as Response);
    mockFetch.mockResolvedValue({ ok: false, status: 503 } as Response);

    const promise = callRuntimeEvaluate({ caseId: 'c_003', policyRefs: [] });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeDefined(); // must not throw
    vi.useRealTimers();
  });
});
