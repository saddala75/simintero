import type { FhirValueSet } from './vkas.js';

export interface ValidateCodeResult {
  resolved: boolean;
  result: boolean;
  display?: string;
}

/**
 * Validate a code against a resolved value-set.
 * - vs null            → not resolved (caller answers 404).
 * - resolved, no code  → resolvability probe (result:true) — the digicore-authoring path.
 * - resolved, code     → membership over expansion.contains; system optional.
 */
export function validateCode(
  vs: FhirValueSet | null,
  system?: string,
  code?: string,
): ValidateCodeResult {
  if (vs === null) return { resolved: false, result: false };
  if (code === undefined) return { resolved: true, result: true };

  const concepts = vs.expansion?.contains ?? [];
  const match = concepts.find(
    (c) => c.code === code && (system === undefined || c.system === system),
  );
  if (match) return { resolved: true, result: true, display: match.display ?? '' };
  return { resolved: true, result: false };
}
