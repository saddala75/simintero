export interface MeasureResult {
  member_id: string;
  measure_ref: string;
  numerator: boolean;
  denominator: boolean;
  exclusion: boolean;
  evidence_refs: string[];
  trace_ref: string | null;
}

export async function evaluateMeasure(
  memberId: string,
  measureRef: string,
  measureVersion: string,
  periodStart: string,
  periodEnd: string,
  digicoreUrl: string,
): Promise<MeasureResult | null> {
  try {
    const res = await fetch(`${digicoreUrl}/v1/runtime/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        measure_ref: measureRef,
        measure_version: measureVersion,
        member_id: memberId,
        period_start: periodStart,
        period_end: periodEnd,
        evidence_query: {
          fabric_filter: { member_id: memberId, period: { start: periodStart, end: periodEnd } },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      numerator: boolean;
      denominator: boolean;
      exclusion?: boolean;
      evidence_refs?: string[];
      trace_ref?: string;
    };

    if (typeof data.numerator !== 'boolean' || typeof data.denominator !== 'boolean') {
      return null;
    }

    return {
      member_id: memberId,
      measure_ref: measureRef,
      numerator: data.numerator,
      denominator: data.denominator,
      exclusion: data.exclusion ?? false,
      evidence_refs: data.evidence_refs ?? [],
      trace_ref: data.trace_ref ?? null,
    };
  } catch {
    return null;
  }
}
