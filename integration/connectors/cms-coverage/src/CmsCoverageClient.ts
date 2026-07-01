import { XMLParser } from 'fast-xml-parser';
import type { NcdRecord, CoverageIndicator } from './types.js';

const parser = new XMLParser({
  isArray: (name) => name === 'NationalCoverage' || name === 'CPTCode',
});

function parseCoverageStatus(raw: string): CoverageIndicator {
  const s = (raw ?? '').toUpperCase().replace(/ /g, '_');
  if (s === 'COVERED_WITH_LIMITATIONS') return 'covered_with_limitations';
  if (s === 'NOT_COVERED' || s === 'NON_COVERED') return 'non_covered';
  return 'covered';
}

function parseDate(raw: string): string {
  const s = String(raw ?? '');
  // CMS sends YYYYMMDD — convert to YYYY-MM-DD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

export class CmsCoverageClient {
  constructor(private readonly baseUrl: string) {}

  async fetchNcds(): Promise<NcdRecord[]> {
    const res = await fetch(this.baseUrl);
    if (!res.ok) throw new Error(`CMS NCD download failed: ${res.status}`);
    const xml = await res.text();
    const doc = parser.parse(xml) as Record<string, unknown>;
    const root = doc['NationalCoverageList'] as Record<string, unknown> | undefined;
    const items = (root?.['NationalCoverage'] as unknown[] | undefined) ?? [];
    return items.map((item) => {
      const n = item as Record<string, unknown>;
      const codes = n['CPTCodes'] as Record<string, unknown> | undefined;
      const cptRaw = codes?.['CPTCode'];
      const procedureCodes: string[] = Array.isArray(cptRaw)
        ? (cptRaw as unknown[]).map(String)
        : cptRaw != null ? [String(cptRaw)] : [];
      return {
        ncdId: String(n['NCDId'] ?? ''),
        title: String(n['Title'] ?? ''),
        effectiveDate: parseDate(String(n['EffectiveDate'] ?? '')),
        coverageIndicator: parseCoverageStatus(String(n['CoverageStatus'] ?? '')),
        procedureCodes,
        criteriaText: String(n['CriteriaText'] ?? ''),
      };
    });
  }
}
