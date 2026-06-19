export interface Concept {
  system?: string;
  code: string;
  display?: string;
}

export interface FhirValueSet {
  resourceType?: string;
  url?: string;
  version?: string;
  status?: string;
  expansion?: { contains?: Concept[] };
}

/**
 * Resolve a FHIR value-set from VKAS by canonical URL.
 * Returns the ValueSet content on 200, or null on 404 / any non-200 / network error.
 * NEVER throws — a VKAS outage degrades to "unresolved", never a 5xx.
 */
export async function resolveValueSet(
  vkasBaseUrl: string,
  url: string,
): Promise<FhirValueSet | null> {
  const endpoint = `${vkasBaseUrl}/v1/artifacts:resolve?canonical_url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(endpoint);
    if (res.status !== 200) return null;
    const body = (await res.json()) as { content?: FhirValueSet };
    return body.content ?? null;
  } catch {
    return null;
  }
}
