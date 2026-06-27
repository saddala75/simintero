import { randomUUID } from 'crypto'

export interface MeasureRunContext {
  runId: string
  measureRef: string
  measureUrl: string
  periodStart: string
  periodEnd: string
  tenantId: string
}

// Accepts either MemberResult (from evaluateWithDigicore) or MeasureResult (legacy SQL)
export interface PopulationInput {
  memberRef?: string
  member_id?: string
  denominator: boolean
  numerator: boolean
  exclusion: boolean
  exception?: boolean
  traceRef?: string
  trace_ref?: string | null
  evidenceRefs?: string[]
  evidence_refs?: string[]
}

const DEQM_POP_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-population'

function popCode(code: string) {
  return { coding: [{ system: DEQM_POP_SYSTEM, code }] }
}

function getMemberId(m: PopulationInput): string {
  return (m.memberRef ?? m.member_id) || 'unknown'
}

function getTraceRef(m: PopulationInput): string | null {
  return m.traceRef ?? m.trace_ref ?? null
}

function getEvidenceRefs(m: PopulationInput): string[] {
  return m.evidenceRefs ?? m.evidence_refs ?? []
}

export function buildIndividualMeasureReport(
  ctx: MeasureRunContext,
  member: PopulationInput,
): object {
  return {
    resourceType: 'MeasureReport',
    id: randomUUID(),
    meta: {
      profile: [
        'http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/indv-measurereport-deqm',
      ],
    },
    status: 'complete',
    type: 'individual',
    measure: ctx.measureUrl,
    subject: { reference: `Patient/${getMemberId(member)}` },
    date: new Date().toISOString(),
    period: { start: ctx.periodStart, end: ctx.periodEnd },
    group: [
      {
        population: [
          { code: popCode('denominator'), count: member.denominator ? 1 : 0 },
          { code: popCode('numerator'),   count: member.numerator   ? 1 : 0 },
          { code: popCode('exclusion'),   count: member.exclusion   ? 1 : 0 },
          { code: popCode('exception'),   count: (member.exception ?? false) ? 1 : 0 },
        ],
      },
    ],
    evaluatedResource: getEvidenceRefs(member).map(ref => ({ reference: ref })),
    extension: [
      {
        url: 'http://sim.internal/fhir/StructureDefinition/trace-ref',
        valueString: getTraceRef(member) ?? '',
      },
    ],
  }
}

export function buildSummaryMeasureReport(
  ctx: MeasureRunContext,
  members: PopulationInput[],
): object {
  const sum = (fn: (m: PopulationInput) => boolean) => members.filter(fn).length

  const denomCount = sum(m => m.denominator)
  const numCount   = sum(m => m.numerator)

  return {
    resourceType: 'MeasureReport',
    id: randomUUID(),
    meta: {
      profile: [
        'http://hl7.org/fhir/us/davinci-deqm/StructureDefinition/summary-measurereport-deqm',
      ],
    },
    status: 'complete',
    type: 'summary',
    measure: ctx.measureUrl,
    date: new Date().toISOString(),
    period: { start: ctx.periodStart, end: ctx.periodEnd },
    group: [
      {
        population: [
          { code: popCode('denominator'), count: denomCount },
          { code: popCode('numerator'),   count: numCount },
          { code: popCode('exclusion'),   count: sum(m => m.exclusion) },
          { code: popCode('exception'),   count: sum(m => m.exception ?? false) },
        ],
        measureScore: {
          value: denomCount > 0 ? numCount / denomCount : 0,
        },
      },
    ],
  }
}
