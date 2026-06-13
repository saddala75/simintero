const TRACE_SERVICE_URL =
  process.env['TRACE_SERVICE_URL'] ?? 'http://localhost:9080';

export interface TraceResult {
  traceRef: string;
  rules: string[];
  raw: string | null;
}

/**
 * Trace resolver stub — fetches rules trace from the trace service.
 * Returns empty trace on 404, 501, or any network failure.
 */
export async function resolveTrace(traceRef: string): Promise<TraceResult> {
  try {
    const resp = await fetch(
      `${TRACE_SERVICE_URL}/v1/trace/${encodeURIComponent(traceRef)}`,
      {
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!resp.ok) {
      return { traceRef, rules: [], raw: null };
    }
    return (await resp.json()) as TraceResult;
  } catch {
    return { traceRef, rules: [], raw: null };
  }
}
