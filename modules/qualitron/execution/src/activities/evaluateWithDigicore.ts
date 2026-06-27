export interface MemberResult {
  memberRef: string
  denominator: boolean
  numerator: boolean
  exclusion: boolean
  exception: boolean
  traceRef: string
}

export interface DigicoreMeasureInput {
  tenantId: string
  libraryRef: string
  memberRefs: string[]
  periodStart: string
  periodEnd: string
}

const DIGICORE_URL =
  process.env['DIGICORE_SERVICE_URL'] ?? 'http://localhost:4010'

export async function evaluateWithDigicore(
  input: DigicoreMeasureInput,
): Promise<MemberResult[]> {
  const res = await fetch(`${DIGICORE_URL}/v1/runtime/measure-evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sim-tenant-id': input.tenantId,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(
      `Digicore measure-evaluate ${res.status}: ${await res.text()}`,
    )
  }
  const body = (await res.json()) as { results: MemberResult[] }
  return body.results
}
