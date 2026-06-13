import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { detectGap } from '../GapDetector.js';
import { handleMeasureReportCompleted } from '../GapEventHandler.js';
import type { MeasureReportCompletedPayload } from '../GapEventHandler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(
  rows: unknown[] = [],
  extraCalls?: Array<{ rows: unknown[] }>,
): Pool {
  const mock = vi.fn().mockResolvedValue({ rows });
  if (extraCalls) {
    // Queue sequential mock returns: first call returns rows, remaining return extraCalls entries
    mock.mockResolvedValueOnce({ rows });
    for (const call of extraCalls) {
      mock.mockResolvedValueOnce({ rows: call.rows });
    }
  }
  return { query: mock } as unknown as Pool;
}

const BASE_PAYLOAD: MeasureReportCompletedPayload = {
  event_type: 'MeasureReportCompleted',
  run_id: 'run_001',
  member_id: 'mem_001',
  measure_ref: 'hedis:BCS-E',
  numerator: false,
  denominator: true,
  exclusion: false,
};

const PERIOD_START = '2024-01-01';
const PERIOD_END = '2024-12-31';
const TENANT_ID = 'tenant_abc';
const TASK_SERVICE_URL = 'http://task-service.internal';

// ---------------------------------------------------------------------------
// detectGap unit tests
// ---------------------------------------------------------------------------

describe('detectGap', () => {
  it('test 1: member not in denominator → has_gap: false', () => {
    const result = detectGap({
      run_id: 'run_001',
      member_id: 'mem_001',
      measure_ref: 'hedis:BCS-E',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      numerator: false,
      denominator: false,
      exclusion: false,
    });
    expect(result.has_gap).toBe(false);
    expect(result.gap_type).toBeNull();
    expect(result.should_create_outreach).toBe(false);
  });

  it('test 2: member excluded → has_gap: false', () => {
    const result = detectGap({
      run_id: 'run_001',
      member_id: 'mem_001',
      measure_ref: 'hedis:BCS-E',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      numerator: false,
      denominator: true,
      exclusion: true,
    });
    expect(result.has_gap).toBe(false);
    expect(result.gap_type).toBeNull();
    expect(result.should_create_outreach).toBe(false);
  });

  it('test 3: numerator true (measure met) → has_gap: false', () => {
    const result = detectGap({
      run_id: 'run_001',
      member_id: 'mem_001',
      measure_ref: 'hedis:BCS-E',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      numerator: true,
      denominator: true,
      exclusion: false,
    });
    expect(result.has_gap).toBe(false);
    expect(result.gap_type).toBeNull();
    expect(result.should_create_outreach).toBe(false);
  });

  it('test 4: denominator true, numerator false, not excluded → has_gap: true, gap_type: missing_numerator, should_create_outreach: true', () => {
    const result = detectGap({
      run_id: 'run_001',
      member_id: 'mem_001',
      measure_ref: 'hedis:BCS-E',
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      numerator: false,
      denominator: true,
      exclusion: false,
    });
    expect(result.has_gap).toBe(true);
    expect(result.gap_type).toBe('missing_numerator');
    expect(result.should_create_outreach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleMeasureReportCompleted integration tests (pool + fetch mocks)
// ---------------------------------------------------------------------------

describe('handleMeasureReportCompleted', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('test 5: gap detected → inserts gap row and outreach_task_ref when Task Service returns task_id', async () => {
    // Pool: SELECT (no existing gap), INSERT gap, INSERT outreach_task_ref
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [] })          // SELECT existing gap → none
      .mockResolvedValueOnce({ rows: [] })          // INSERT qual.gap
      .mockResolvedValueOnce({ rows: [] });         // INSERT qual.outreach_task_ref

    const pool = { query: queryMock } as unknown as Pool;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'task_abc123' }),
    }));

    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      TENANT_ID,
      PERIOD_START,
      PERIOD_END,
      pool,
      TASK_SERVICE_URL,
    );

    // SELECT + INSERT gap + INSERT outreach_task_ref = 3 calls
    expect(queryMock).toHaveBeenCalledTimes(3);

    const gapInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO qual.gap'),
    );
    expect(gapInsertCall).toBeTruthy();

    const outreachInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('qual.outreach_task_ref'),
    );
    expect(outreachInsertCall).toBeTruthy();

    // Verify task_id was stored
    const outreachParams = outreachInsertCall?.[1] as string[];
    expect(outreachParams).toContain('task_abc123');
  });

  it('test 6: prior gap closed when numerator is met (runs UPDATE query)', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: queryMock } as unknown as Pool;

    const payloadWithNumerator: MeasureReportCompletedPayload = {
      ...BASE_PAYLOAD,
      numerator: true,
    };

    // No fetch needed — numerator met, no outreach
    await handleMeasureReportCompleted(
      payloadWithNumerator,
      TENANT_ID,
      PERIOD_START,
      PERIOD_END,
      pool,
      TASK_SERVICE_URL,
    );

    expect(queryMock).toHaveBeenCalledTimes(1);

    const updateCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE qual.gap'),
    );
    expect(updateCall).toBeTruthy();

    const updateSql = updateCall?.[0] as string;
    expect(updateSql).toContain("closure_reason = 'numerator_met'");
  });

  it('test 7: Task Service failure (returns null) does NOT abort gap write — gap row still inserted', async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [] })   // SELECT existing gap → none
      .mockResolvedValueOnce({ rows: [] }); // INSERT qual.gap

    const pool = { query: queryMock } as unknown as Pool;

    // Simulate Task Service failure
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));

    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      TENANT_ID,
      PERIOD_START,
      PERIOD_END,
      pool,
      TASK_SERVICE_URL,
    );

    // SELECT + INSERT gap = 2 calls (no outreach_task_ref insert because task failed)
    expect(queryMock).toHaveBeenCalledTimes(2);

    const gapInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO qual.gap'),
    );
    expect(gapInsertCall).toBeTruthy();

    const outreachInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('qual.outreach_task_ref'),
    );
    expect(outreachInsertCall).toBeUndefined();
  });

  it('test 8: existing open gap not re-inserted (upsert idempotency — uses existing gap_id, skips INSERT)', async () => {
    const existingGapId = 'gap_existing_001';

    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [{ gap_id: existingGapId }] })  // SELECT → existing gap found
      .mockResolvedValueOnce({ rows: [] });                           // INSERT outreach_task_ref

    const pool = { query: queryMock } as unknown as Pool;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: 'task_new_999' }),
    }));

    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      TENANT_ID,
      PERIOD_START,
      PERIOD_END,
      pool,
      TASK_SERVICE_URL,
    );

    // Only SELECT + INSERT outreach_task_ref (no gap INSERT because it already existed)
    expect(queryMock).toHaveBeenCalledTimes(2);

    const gapInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO qual.gap'),
    );
    expect(gapInsertCall).toBeUndefined();

    // The outreach task ref should reference the existing gap_id
    const outreachInsertCall = queryMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('qual.outreach_task_ref'),
    );
    expect(outreachInsertCall).toBeTruthy();
    const outreachParams = outreachInsertCall?.[1] as string[];
    expect(outreachParams).toContain(existingGapId);
  });
});
