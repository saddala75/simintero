import type { NcdRecord, VkasArtifact } from './types.js';

export interface NcdSyncResult {
  ncdId: string;
  synced: number;
  failed: number;
  errors: string[];
}

function buildArtifact(ncd: NcdRecord, procedureCode: string): VkasArtifact {
  return {
    canonical_url: `urn:cms:ncd:procedure:${procedureCode}`,
    version: ncd.effectiveDate,
    tenant_id: 'shared',
    artifact_type: 'coverage_rule',
    status: 'active',
    created_by: 'ncd-sync',
    content: {
      source_type: 'ncd',
      procedure_codes: [procedureCode],
      pa_required: ncd.coverageIndicator === 'covered_with_limitations',
      coverage_indicator: ncd.coverageIndicator,
      ncd_id: ncd.ncdId,
      ncd_title: ncd.title,
      effective_date: ncd.effectiveDate,
      criteria_text: ncd.criteriaText,
      evidence_requirements: [],
      elm_ref: null,
      elm_version: null,
      relations: [],
    },
  };
}

export async function ingestNcds(ncds: NcdRecord[], vkasBaseUrl: string): Promise<NcdSyncResult[]> {
  return Promise.all(ncds.map(async (ncd) => {
    const result: NcdSyncResult = { ncdId: ncd.ncdId, synced: 0, failed: 0, errors: [] };
    for (const code of ncd.procedureCodes) {
      try {
        const res = await fetch(`${vkasBaseUrl}/v1/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildArtifact(ncd, code)),
        });
        if (res.ok) { result.synced++; }
        else { result.failed++; result.errors.push(`VKAS ${res.status} for ${code}`); }
      } catch (err) {
        result.failed++;
        result.errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }));
}
