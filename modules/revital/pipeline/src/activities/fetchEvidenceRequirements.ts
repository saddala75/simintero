export interface CodeRef { system: string; code: string; }

export interface Requirement {
  id: string;
  description: string;
  required?: boolean | undefined;
  evidence_types: string[];
  codes?: CodeRef[] | undefined;
  negates?: CodeRef[] | undefined;
}

export interface RequirementsResult {
  requirements: Requirement[];
  trace_ref: string;
  pins: Array<{ canonical_url: string; version: string }>;
}

export async function fetchEvidenceRequirementsImpl(
  serviceCode: string,
  digicoreUrl: string,
): Promise<RequirementsResult | null> {
  if (!serviceCode) return null;
  try {
    const res = await fetch(`${digicoreUrl}/v1/runtime/evidence-requirements:resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_code: serviceCode }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { requirements?: any[]; pins?: string[] };
    const requirements: Requirement[] = (json.requirements ?? []).map((r) => ({
      id: r.requirement_id ?? r.id,
      description: r.display ?? r.description ?? '',
      required: r.required ?? true,
      evidence_types: Array.isArray(r.evidence_types) ? r.evidence_types : [],
      codes: Array.isArray(r.codes) ? r.codes : undefined,
      negates: Array.isArray(r.negates) ? r.negates : undefined,
    }));
    const pins = (json.pins ?? []).map((p) => ({ canonical_url: p, version: '' }));
    return { requirements, trace_ref: `evidence-requirements:${serviceCode}`, pins };
  } catch {
    return null;
  }
}

const DIGICORE_URL = process.env['DIGICORE_URL'] ?? 'http://localhost:3040';

export async function fetchEvidenceRequirements(serviceCode: string): Promise<RequirementsResult | null> {
  return fetchEvidenceRequirementsImpl(serviceCode, DIGICORE_URL);
}
