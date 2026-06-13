/**
 * Activity: callCoverageDiscovery
 * POSTs to C-1 /v1/runtime/coverage-discovery to fetch member entitlements.
 * Falls back to stub entitlements when C-1 is unavailable (Phase 0 / 501).
 */

export interface CallCoverageDiscoveryInput {
  caseId: string;
  tenantId: string;
}

export interface CallCoverageDiscoveryResult {
  entitlements: Record<string, unknown>;
}

const STUB_ENTITLEMENTS: Record<string, unknown> = {
  module: {
    DIG: { enabled: true },
  },
};

export async function callCoverageDiscovery(
  input: CallCoverageDiscoveryInput,
): Promise<CallCoverageDiscoveryResult> {
  const digicoreUrl = process.env['DIGICORE_URL'] ?? 'http://localhost:8090';
  const url = `${digicoreUrl}/v1/runtime/coverage-discovery`;

  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: input.caseId, tenant_id: input.tenantId }),
    });
  } catch (_err) {
    return { entitlements: STUB_ENTITLEMENTS };
  }

  if (response.status === 501 || response.status === 503) {
    return { entitlements: STUB_ENTITLEMENTS };
  }

  if (!response.ok) {
    throw new Error(`C-1 coverage-discovery failed with status ${response.status}`);
  }

  const body = (await response.json()) as { entitlements?: Record<string, unknown> };
  return { entitlements: body.entitlements ?? STUB_ENTITLEMENTS };
}
