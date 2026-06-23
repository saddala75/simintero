import type { Concept } from './vkas.js';
import { resolveValueSet } from './vkas.js';

/**
 * Local search corpus — the three value sets seeded in V022.
 * This is the seam a real VSAC / SNOMED-CT dataset replaces in a later slice.
 */
export const SEARCH_VALUE_SETS: string[] =
  process.env['TERMINOLOGY_SEARCH_VALUESETS']?.split(',') ?? [
    // Knee conditions (SNOMED CT + ICD-10-CM) — OID 2.16.840.1.113883.3.526.3.1498
    'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498',
    // Mammography (LOINC 24604-1) — OID 2.16.840.1.113883.3.464.1003.108.12.1018
    'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
    // Office Visit (CPT 99213) — OID 2.16.840.1.113883.3.464.1003.198.12.1019
    'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1019',
  ];

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Pure: search `contains` for a concept whose display matches `text`.
 * 1. Exact normalized-display match first.
 * 2. Substring fallback (either direction).
 * Returns the first matching Concept or null.
 */
export function findCodeInContains(text: string, contains: Concept[]): Concept | null {
  const normText = normalize(text);
  // 1. exact normalized match
  const exact = contains.find((c) => normalize(c.display ?? '') === normText);
  if (exact) return exact;
  // 2. substring fallback
  const sub = contains.find((c) => {
    const normDisplay = normalize(c.display ?? '');
    return normDisplay.includes(normText) || normText.includes(normDisplay);
  });
  return sub ?? null;
}

export type FindCodeResult =
  | { found: true; system: string; code: string; display: string; value_set_url: string }
  | { found: false };

/**
 * Search the given value-set URLs for a concept whose display matches `text`.
 * For each URL, resolves via VKAS and collects expansion.contains.
 * A null resolve (VKAS 404 / outage) is silently skipped.
 */
export async function findCode(
  vkasBaseUrl: string,
  text: string,
  urls: string[],
): Promise<FindCodeResult> {
  const allContains: Concept[] = [];
  const vsUrlByCode = new Map<string, string>();

  for (const url of urls) {
    const vs = await resolveValueSet(vkasBaseUrl, url);
    const contains = vs?.expansion?.contains ?? [];
    for (const c of contains) {
      allContains.push(c);
      vsUrlByCode.set(c.code, url);
    }
  }

  const match = findCodeInContains(text, allContains);
  if (!match) return { found: false };

  return {
    found: true,
    system: match.system ?? '',
    code: match.code,
    display: match.display ?? '',
    value_set_url: vsUrlByCode.get(match.code) ?? '',
  };
}
