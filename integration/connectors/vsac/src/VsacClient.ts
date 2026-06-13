import { fetch } from 'undici';
import type { VsacConfig, ValueSet, Concept, ValueSetMetadata } from './types.js';

export class VsacClient {
  constructor(private cfg: VsacConfig) {}

  private get authHeader(): string {
    const encoded = Buffer.from(`apikey:${this.cfg.apiKey}`).toString('base64');
    return `Basic ${encoded}`;
  }

  async expandValueSet(oid: string, version?: string): Promise<ValueSet> {
    const params = new URLSearchParams({ id: oid });
    if (version) params.set('version', version);

    const res = await fetch(`${this.cfg.baseUrl}/RetrieveValueSet?${params}`, {
      headers: { 'Authorization': this.authHeader },
    });
    if (!res.ok) throw new Error(`VSAC expansion failed for OID ${oid}: ${res.status}`);

    const xml = await res.text();
    return parseVsacXml(xml);
  }

  async getValueSetMetadata(oid: string): Promise<ValueSetMetadata> {
    const params = new URLSearchParams({ id: oid, returnType: 'metadata' });

    const res = await fetch(`${this.cfg.baseUrl}/RetrieveValueSet?${params}`, {
      headers: { 'Authorization': this.authHeader },
    });
    if (!res.ok) throw new Error(`VSAC metadata failed for OID ${oid}: ${res.status}`);

    const xml = await res.text();
    return parseVsacMetadataXml(xml);
  }
}

function parseVsacXml(xml: string): ValueSet {
  const oidMatch = /\bID="([^"]+)"/.exec(xml);
  const versionMatch = /<[^>]*ValueSet[^>]*\bversion="([^"]+)"/.exec(xml);
  const valueSetDisplayNameMatch = /<[^>]*ValueSet[^>]*\bdisplayName="([^"]+)"/.exec(xml);

  const concepts: Concept[] = [];
  const conceptRegex = /<[^>]*Concept[^>]*\bcode="([^"]+)"[^>]*\bcodeSystem="([^"]+)"[^>]*\bdisplayName="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = conceptRegex.exec(xml)) !== null) {
    concepts.push({ code: m[1], codeSystem: m[2], displayName: m[3] });
  }

  return {
    oid: oidMatch?.[1] ?? '',
    version: versionMatch?.[1] ?? '',
    displayName: valueSetDisplayNameMatch?.[1] ?? '',
    concepts,
  };
}

function parseVsacMetadataXml(xml: string): ValueSetMetadata {
  const oidMatch = /\bID="([^"]+)"/.exec(xml);
  const versionMatch = /<[^>]*ValueSet[^>]*\bversion="([^"]+)"/.exec(xml);
  const displayNameMatch = /<[^>]*ValueSet[^>]*\bdisplayName="([^"]+)"/.exec(xml);
  return {
    oid: oidMatch?.[1] ?? '',
    version: versionMatch?.[1] ?? '',
    displayName: displayNameMatch?.[1] ?? '',
  };
}
