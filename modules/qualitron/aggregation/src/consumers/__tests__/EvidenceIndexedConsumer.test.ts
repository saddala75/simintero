import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makePool(queryResponses: Array<{ rows: unknown[] }> = []) {
  let idx = 0
  const client = {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(queryResponses[idx++] ?? { rows: [] }),
    ),
    release: vi.fn(),
  }
  return {
    pool: { connect: vi.fn().mockResolvedValue(client) } as any,
    client,
  }
}

describe('handleEvidenceIndexed', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls Digicore and closes gap when numerator flips true', async () => {
    const { pool, client } = makePool([
      { rows: [] },                                              // BEGIN (implicit in withTenant)
      { rows: [] },                                             // set_config
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] }, // measure_definitions
      { rows: [{ member_ref: 'member-001' }] },                  // ens.case lookup
      { rows: [{ gap_id: 'gap-01', member_id: 'member-001', measure_ref: 'hedis:BCS-E', period_start: '2025-01-01', period_end: '2025-12-31' }] }, // open gaps
      { rows: [] },                                              // UPDATE qual.gap
      { rows: [] },                                              // INSERT shared.outbox
      { rows: [] },                                             // COMMIT
    ])

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ memberRef: 'member-001', denominator: true, numerator: true, exclusion: false, exception: false, traceRef: 'trace-x' }],
      }),
    })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    await handleEvidenceIndexed(
      { event_type: 'EvidenceIndexed', source_event_id: 'evt1', doc_id: 'doc1', case_ref: 'case-001' },
      'tenant-dev',
      pool,
    )

    // Should have called Digicore
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/runtime/measure-evaluate'),
      expect.any(Object),
    )
    // Should have closed the gap
    const calls = client.query.mock.calls as Array<[string, ...unknown[]]>
    const updateGapCall = calls.find(c => typeof c[0] === 'string' && c[0].includes("status = 'closed'"))
    expect(updateGapCall).toBeTruthy()
  })

  it('does NOT close gap when numerator stays false', async () => {
    const { pool, client } = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] },
      { rows: [{ member_ref: 'member-002' }] },
      { rows: [{ gap_id: 'gap-02', member_id: 'member-002', measure_ref: 'hedis:BCS-E', period_start: '2025-01-01', period_end: '2025-12-31' }] },
      { rows: [] },
    ])

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ memberRef: 'member-002', denominator: true, numerator: false, exclusion: false, exception: false, traceRef: 'trace-y' }],
      }),
    })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    await handleEvidenceIndexed(
      { event_type: 'EvidenceIndexed', source_event_id: 'evt2', doc_id: 'doc2', case_ref: 'case-002' },
      'tenant-dev',
      pool,
    )

    const calls = client.query.mock.calls as Array<[string, ...unknown[]]>
    const closeCall = calls.find(c => typeof c[0] === 'string' && c[0].includes("status = 'closed'"))
    expect(closeCall).toBeUndefined()
  })

  it('acks without throwing even when Digicore returns error', async () => {
    const { pool } = makePool([
      { rows: [] },
      { rows: [] },
      { rows: [{ measure_ref: 'hedis:BCS-E', measure_version: '1.0.0', digicore_library_ref: 'url', tenant_id: 'tenant-dev' }] },
      { rows: [{ member_ref: 'member-003' }] },
      { rows: [] },
    ])

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })

    const { handleEvidenceIndexed } = await import('../EvidenceIndexedConsumer.js')
    // Should not throw
    await expect(
      handleEvidenceIndexed(
        { event_type: 'EvidenceIndexed', source_event_id: 'evt3', doc_id: 'doc3', case_ref: 'case-003' },
        'tenant-dev',
        pool,
      )
    ).resolves.not.toThrow()
  })
})
