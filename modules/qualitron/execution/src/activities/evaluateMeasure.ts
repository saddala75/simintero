import type { PoolClient } from 'pg';
import { ulid } from 'ulid';

export interface MeasureSpec {
  denominator?: { resource_type: string };
  numerator: { resource_type: string; code: string };
  exclusion?: { resource_type: string; code: string };
}

export interface MeasureResult {
  member_id: string;
  measure_ref: string;
  numerator: boolean;
  denominator: boolean;
  exclusion: boolean;
  evidence_refs: string[];
  trace_ref: string | null;
}

async function matchingResources(
  client: PoolClient,
  memberRef: string,
  resourceType: string,
  code: string,
  periodStart: string,
  periodEnd: string,
): Promise<string[]> {
  const { rows } = await client.query<{ fhir_id: string }>(
    `SELECT fhir_id FROM fabric.resource
     WHERE tenant_id = current_setting('sim.tenant_id', true)
       AND member_ref = $1 AND resource_type = $2
       AND content->'code'->'coding'->0->>'code' = $3
       AND last_updated >= $4::timestamptz AND last_updated <= $5::timestamptz`,
    [memberRef, resourceType, code, periodStart, periodEnd],
  );
  return rows.map((r) => r.fhir_id);
}

/** Evaluate a measure for one member against fabric.resource (self-contained, no digicore). */
export async function evaluateMeasure(
  client: PoolClient,
  memberRef: string,
  measureRef: string,
  spec: MeasureSpec,
  periodStart: string,
  periodEnd: string,
): Promise<MeasureResult> {
  const denominator = true; // member is in the eligible Patient population (fetched as denominator)
  const numEvidence = await matchingResources(
    client,
    memberRef,
    spec.numerator.resource_type,
    spec.numerator.code,
    periodStart,
    periodEnd,
  );
  const numerator = numEvidence.length > 0;
  let exclusion = false;
  if (spec.exclusion) {
    const exEvidence = await matchingResources(
      client,
      memberRef,
      spec.exclusion.resource_type,
      spec.exclusion.code,
      periodStart,
      periodEnd,
    );
    exclusion = exEvidence.length > 0;
  }
  return {
    member_id: memberRef,
    measure_ref: measureRef,
    numerator,
    denominator,
    exclusion,
    evidence_refs: numEvidence,
    trace_ref: 'qual-trace:' + ulid(),
  };
}
