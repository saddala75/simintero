export interface SeedPack {
  canonical_url: string;
  version: string;
  artifact_type: string;
  lob: string;
  program?: string;
}

const REGISTRY_URL = import.meta.env['VITE_REGISTRY_URL'] ?? 'http://localhost:3010';

export const vkasClient = {
  async getSeedPacks(lob: string): Promise<SeedPack[]> {
    const url = new URL(`${REGISTRY_URL}/v1/registry/artifacts`);
    url.searchParams.set('artifact_type', 'cql_library');
    url.searchParams.set('lob', lob);
    const res = await fetch(url.toString());
    const data = (await res.json()) as { items: SeedPack[] };
    return data.items ?? [];
  },
};
