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
      const canonicalUrl = `urn:cms:ncd:procedure:${code}`;
      try {
        const createRes = await fetch(`${vkasBaseUrl}/v1/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildArtifact(ncd, code)),
        });
        if (createRes.status === 409) {
          // Already exists from a prior sync — skip activation, count as synced
          result.synced++;
          continue;
        }
        if (!createRes.ok) {
          result.failed++;
          result.errors.push(`VKAS ${createRes.status} for ${code}`);
          continue;
        }
        // New artifact created as draft — drive through lifecycle to active
        const submitRes = await fetch(`${vkasBaseUrl}/v1/artifacts/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canonical_url: canonicalUrl, version: ncd.effectiveDate }),
        });
        if (!submitRes.ok) {
          result.failed++;
          result.errors.push(`submit failed ${submitRes.status} for ${code}`);
          continue;
        }
        const activateRes = await fetch(`${vkasBaseUrl}/v1/artifacts/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canonical_url: canonicalUrl, version: ncd.effectiveDate }),
        });
        if (!activateRes.ok) {
          result.failed++;
          result.errors.push(`activate failed ${activateRes.status} for ${code}`);
          continue;
        }
        result.synced++;
      } catch (err) {
        result.failed++;
        result.errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }));
}
