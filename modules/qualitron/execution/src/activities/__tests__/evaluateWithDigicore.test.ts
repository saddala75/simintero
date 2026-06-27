import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DigicoreMeasureInput } from '../evaluateWithDigicore.js'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => vi.resetAllMocks())

const INPUT: DigicoreMeasureInput = {
  tenantId: 'tenant-test',
  libraryRef: 'https://artifacts.simintero.io/shared/cql_library/bcs-e',
  memberRefs: ['m1', 'm2'],
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
}

const RESULTS = [
  { memberRef: 'm1', denominator: true, numerator: true, exclusion: false, exception: false, traceRef: 'trace-1' },
  { memberRef: 'm2', denominator: true, numerator: false, exclusion: false, exception: false, traceRef: 'trace-2' },
]

describe('evaluateWithDigicore', () => {
  it('POSTs to Digicore and returns MemberResult[]', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: RESULTS }),
    })

    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    const result = await evaluateWithDigicore(INPUT)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/runtime/measure-evaluate'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-sim-tenant-id': 'tenant-test' }),
      }),
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.memberRef).toBe('m1')
    expect(result[0]!.numerator).toBe(true)
    expect(result[1]!.numerator).toBe(false)
  })

  it('throws on non-200 response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    await expect(evaluateWithDigicore(INPUT)).rejects.toThrow('404')
  })

  it('throws on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'))
    const { evaluateWithDigicore } = await import('../evaluateWithDigicore.js')
    await expect(evaluateWithDigicore(INPUT)).rejects.toThrow('connection refused')
  })
})
