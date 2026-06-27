import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makePool(responses: Array<{ rows: unknown[] }> = []) {
  let idx = 0
  return {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(responses[idx++] ?? { rows: [] }),
    ),
  } as any
}

const BASE_PAYLOAD = {
  event_type: 'MeasureReportCompleted' as const,
  run_id: 'run_01',
  member_id: 'member-001',
  measure_ref: 'hedis:BCS-E',
  numerator: true,
  denominator: true,
  exclusion: false,
}

describe('handleMeasureReportCompleted — gap closure outbox', () => {
  beforeEach(() => vi.resetAllMocks())

  it('emits QualGapClosed outbox event when gap is closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task_id: 'task-001' }) })

    const pool = makePool([
      // detectGap → has_gap=false (numerator=true), so goes to the else-if close branch
      { rows: [{ gap_id: 'gap-01', member_id: 'member-001', measure_ref: 'hedis:BCS-E' }] }, // UPDATE qual.gap RETURNING
      { rows: [] }, // INSERT shared.outbox (QualGapClosed)
    ])

    const { handleMeasureReportCompleted } = await import('../GapEventHandler.js')
    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      'tenant-dev',
      '2025-01-01',
      '2025-12-31',
      pool,
      'http://localhost:5050',
    )

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>
    const outboxCall = calls.find(
      c => typeof c[0] === 'string' && c[0].includes('shared.outbox'),
    )
    expect(outboxCall).toBeTruthy()

    const envelope = JSON.parse(outboxCall![1]![2] as string) as {
      payload: { event_type: string; gap_id: string; member_id: string }
    }
    expect(envelope.payload.event_type).toBe('QualGapClosed')
    expect(envelope.payload.gap_id).toBe('gap-01')
    expect(envelope.payload.member_id).toBe('member-001')
  })

  it('does not emit outbox event when no open gap exists', async () => {
    const pool = makePool([
      { rows: [] }, // UPDATE returns no rows — no gaps were open
    ])

    const { handleMeasureReportCompleted } = await import('../GapEventHandler.js')
    await handleMeasureReportCompleted(
      BASE_PAYLOAD,
      'tenant-dev',
      '2025-01-01',
      '2025-12-31',
      pool,
      'http://localhost:5050',
    )

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>
    const outboxCall = calls.find(
      c => typeof c[0] === 'string' && c[0].includes('shared.outbox'),
    )
    expect(outboxCall).toBeUndefined()
  })
})
