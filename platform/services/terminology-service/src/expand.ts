import type { FhirValueSet } from './vkas.js';

/** Return the value-set for $expand, or null when unresolved (caller answers 404). */
export function expand(vs: FhirValueSet | null): FhirValueSet | null {
  return vs;
}
