import { describe, it, expect } from 'vitest'
import {
  buildIndividualMeasureReport,
  buildSummaryMeasureReport,
  type MeasureRunContext,
} from '../buildMeasureReport.js'

const CTX: MeasureRunContext = {
  runId: 'run_01',
  measureRef: 'hedis:BCS-E',
  measureUrl: 'http://sim.internal/Measure/hedis:BCS-E',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  tenantId: 'tenant-dev',
}

const MEMBER_IN_NUM = {
  memberRef: 'member-001',
  denominator: true,
  numerator: true,
  exclusion: false,
  exception: false,
  traceRef: 'trace-abc',
  evidenceRefs: ['obs-001'],
}

const MEMBER_NOT_NUM = {
  memberRef: 'member-002',
  denominator: true,
  numerator: false,
  exclusion: false,
  exception: false,
  traceRef: 'trace-def',
}

const DEQM_POP = 'http://terminology.hl7.org/CodeSystem/measure-population'

describe('buildIndividualMeasureReport', () => {
  it('sets resourceType, type, measure, subject correctly', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as Record<string, unknown>
    expect(report['resourceType']).toBe('MeasureReport')
    expect(report['type']).toBe('individual')
    expect(report['measure']).toBe(CTX.measureUrl)
    expect((report['subject'] as { reference: string })['reference']).toBe('Patient/member-001')
  })

  it('sets population counts for numerator-positive member', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    const pops: Array<{ code: { coding: [{ code: string }] }; count: number }> =
      report['group'][0]['population']
    const byCode = Object.fromEntries(pops.map(p => [p.code.coding[0]!.code, p.count]))
    expect(byCode['denominator']).toBe(1)
    expect(byCode['numerator']).toBe(1)
    expect(byCode['exclusion']).toBe(0)
    expect(byCode['exception']).toBe(0)
  })

  it('sets evaluatedResource from evidenceRefs', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    expect(report['evaluatedResource']).toEqual([{ reference: 'obs-001' }])
  })

  it('sets traceRef extension', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    const ext = report['extension'].find(
      (e: { url: string }) => e.url.includes('trace-ref'),
    )
    expect(ext['valueString']).toBe('trace-abc')
  })

  it('includes DEQM Individual profile in meta', () => {
    const report = buildIndividualMeasureReport(CTX, MEMBER_IN_NUM) as any
    expect(report['meta']['profile'][0]).toContain('indv-measurereport-deqm')
  })
})

describe('buildSummaryMeasureReport', () => {
  it('aggregates population counts across members', () => {
    const report = buildSummaryMeasureReport(CTX, [MEMBER_IN_NUM, MEMBER_NOT_NUM]) as any
    const pops: Array<{ code: { coding: [{ code: string }] }; count: number }> =
      report['group'][0]['population']
    const byCode = Object.fromEntries(pops.map(p => [p.code.coding[0]!.code, p.count]))
    expect(byCode['denominator']).toBe(2)
    expect(byCode['numerator']).toBe(1)
    expect(byCode['exclusion']).toBe(0)
  })

  it('computes measureScore as numerator / denominator', () => {
    const report = buildSummaryMeasureReport(CTX, [MEMBER_IN_NUM, MEMBER_NOT_NUM]) as any
    expect(report['group'][0]['measureScore']['value']).toBe(0.5)
  })

  it('measureScore is 0 when denominator is 0 (no division by zero)', () => {
    const report = buildSummaryMeasureReport(CTX, []) as any
    expect(report['group'][0]['measureScore']['value']).toBe(0)
  })

  it('has type summary and DEQM Summary profile', () => {
    const report = buildSummaryMeasureReport(CTX, []) as any
    expect(report['type']).toBe('summary')
    expect(report['meta']['profile'][0]).toContain('summary-measurereport-deqm')
  })
})
