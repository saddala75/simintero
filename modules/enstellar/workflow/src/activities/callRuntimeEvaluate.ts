
export interface CallRuntimeEvaluateInput {
  caseId: string;
  policyRefs: string[];
}

export interface ArtifactPin {
  canonical_url: string;
  version: string;
}

export interface CallRuntimeEvaluateResult {
  eligible: boolean;
  gaps: string[];
  pins: ArtifactPin[];
}

export async function callRuntimeEvaluate(
  input: CallRuntimeEvaluateInput,
): Promise<CallRuntimeEvaluateResult> {
  const digicoreUrl = process.env['DIGICORE_URL'] ?? 'http://localhost:8090';
  const url = `${digicoreUrl}/v1/runtime/evaluate`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: input.caseId, policy_refs: input.policyRefs }),
    });
  } catch (_err) {
    // Connection refused / network error — degrade gracefully
    return { eligible: false, gaps: [], pins: [] };
  }

  if (response.status === 501 || response.status === 503) {
    return { eligible: false, gaps: [], pins: [] };
  }

  if (!response.ok) {
    throw new Error(`C-1 evaluate failed with status ${response.status}`);
  }

  const body = (await response.json()) as {
    eligible?: boolean;
    gaps?: string[];
    pins?: ArtifactPin[];
  };

  const result: CallRuntimeEvaluateResult = {
    eligible: body.eligible ?? false,
    gaps: body.gaps ?? [],
    pins: body.pins ?? [],
  };

  if (result.pins.length > 0) {
    await persistPins(input.caseId, result.pins);
  }

  return result;
}

/**
 * Persists artifact pins to ens.case_pin via the case-service REST API.
 * Retries up to MAX_ATTEMPTS times on 5xx or network errors.
 * 404 (case not found) and post-exhaustion failures are non-fatal —
 * pins are audit data and do not affect PA correctness.
 */
async function persistPins(caseId: string, pins: ArtifactPin[]): Promise<void> {
  const caseServiceUrl = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:8091';
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${caseServiceUrl}/v1/cases/${caseId}/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins }),
      });
      if (res.ok) return;
      if (res.status === 404) return; // case not found — non-retriable
    } catch {
      // network error — retry
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>(resolve => setTimeout(resolve, BASE_DELAY_MS * attempt));
    }
  }
  // After MAX_ATTEMPTS: log but don't throw — pins are non-critical for PA correctness
  console.warn(`[callRuntimeEvaluate] persistPins failed after ${MAX_ATTEMPTS} attempts for case ${caseId}`);
}
