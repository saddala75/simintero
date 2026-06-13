export interface RawEntity {
  resource_type: string;
  raw_text: string;
  coding_hint: string | null;
}

export interface NormalizedEntity {
  resource_type: string;
  normalization: { system: string; code: string; raw_text: string };
}

export function normalizeEntity(raw: RawEntity): NormalizedEntity {
  const coding = raw.coding_hint?.match(/^([^:]+):(.+)$/);
  return {
    resource_type: raw.resource_type,
    normalization: coding
      ? { system: coding[1]!, code: coding[2]!, raw_text: raw.raw_text }
      : { system: 'unknown', code: '', raw_text: raw.raw_text },
  };
}
