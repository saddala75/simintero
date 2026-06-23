export interface RawEntity {
  resource_type: string;
  raw_text: string;
  coding_hint: string | null;
}

/** Injected terminology lookup — keeps unit tests free of live network calls. */
export interface TerminologyLookup {
  validateCode(
    system: string,
    code: string,
  ): Promise<boolean | { valid: boolean; display?: string }>;
  findCode(
    text: string,
  ): Promise<{ system: string; code: string; display: string } | null>;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface CodedResult {
  coded: true;
  validated?: boolean;
  source: 'model-hint' | 'text-search';
  system: string;
  code: string;
  display?: string;
  raw_text: string;
  resource_type: string;
}

export interface UncodedResult {
  coded: false;
  source: 'uncoded';
  raw_text: string;
  resource_type: string;
}

export type NormalizedResult = CodedResult | UncodedResult;

// ---------------------------------------------------------------------------
// Legacy shape — kept so the extractEntities caller can read `.normalization`
// until Task 3 updates it.  The new async `normalizeEntity` returns
// NormalizedResult directly (the caller reads `.system`, `.code`, `.raw_text`
// off the result itself).  The old NormalizedEntity interface is deprecated.
// ---------------------------------------------------------------------------

/** @deprecated use NormalizedResult from the async normalizeEntity */
export interface NormalizedEntity {
  resource_type: string;
  normalization: { system: string; code: string; raw_text: string };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function normalizeEntity(
  raw: RawEntity,
  lookup: TerminologyLookup,
): Promise<NormalizedResult> {
  // Split on the LAST colon so URLs like http://snomed.info/sct:239873007
  // are parsed correctly: system = everything up to the last colon, code = the rest.
  const lastColon = raw.coding_hint ? raw.coding_hint.lastIndexOf(':') : -1;
  const coding =
    lastColon > 0
      ? ([null, raw.coding_hint!.slice(0, lastColon), raw.coding_hint!.slice(lastColon + 1)] as [null, string, string])
      : null;

  if (coding) {
    const system = coding[1]!;
    const code = coding[2]!;
    try {
      const validation = await lookup.validateCode(system, code);
      const validated =
        typeof validation === 'boolean' ? validation : validation.valid;
      const display =
        typeof validation === 'object' && validation.display !== undefined
          ? validation.display
          : undefined;
      return {
        coded: true,
        validated,
        source: 'model-hint',
        system,
        code,
        ...(display !== undefined ? { display } : {}),
        raw_text: raw.raw_text,
        resource_type: raw.resource_type,
      };
    } catch {
      return {
        coded: false,
        source: 'uncoded',
        raw_text: raw.raw_text,
        resource_type: raw.resource_type,
      };
    }
  }

  // No coding hint — try text search
  try {
    const found = await lookup.findCode(raw.raw_text);
    if (found) {
      return {
        coded: true,
        source: 'text-search',
        system: found.system,
        code: found.code,
        display: found.display,
        raw_text: raw.raw_text,
        resource_type: raw.resource_type,
      };
    }
  } catch {
    // fall through to uncoded
  }

  return {
    coded: false,
    source: 'uncoded',
    raw_text: raw.raw_text,
    resource_type: raw.resource_type,
  };
}
