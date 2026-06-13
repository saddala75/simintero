export interface Requirement {
  id: string;
  description: string;
  evidence_types: string[];
}

export interface RequirementsResult {
  requirements: Requirement[];
  trace_ref: string;
  pins: Array<{ canonical_url: string; version: string }>;
}

export async function fetchEvidenceRequirementsImpl(
  requirementsRef: string,
  caseRef: string,
  digicoreUrl: string,
): Promise<RequirementsResult | null> {
  try {
    const res = await fetch(`${digicoreUrl}/v1/runtime/evidence-requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirements_ref: requirementsRef, case_ref: caseRef }),
    });
    if (!res.ok) return null;
    return (await res.json()) as RequirementsResult;
  } catch {
    return null;
  }
}

const DIGICORE_URL = process.env['DIGICORE_URL'] ?? 'http://localhost:3040';

export async function fetchEvidenceRequirements(
  requirementsRef: string,
  caseRef: string,
): Promise<RequirementsResult | null> {
  return fetchEvidenceRequirementsImpl(requirementsRef, caseRef, DIGICORE_URL);
}
