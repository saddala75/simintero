export type CoverageIndicator = 'covered' | 'non_covered' | 'covered_with_limitations';

export interface NcdRecord {
  ncdId: string;
  title: string;
  effectiveDate: string;        // ISO: YYYY-MM-DD
  coverageIndicator: CoverageIndicator;
  procedureCodes: string[];     // CPT/HCPCS
  criteriaText: string;
}

export interface VkasArtifact {
  canonical_url: string;
  version: string;
  tenant_id: 'shared';
  artifact_type: 'coverage_rule';
  status: 'active';
  created_by: 'ncd-sync';
  content: {
    source_type: 'ncd';
    procedure_codes: string[];
    pa_required: boolean;
    coverage_indicator: CoverageIndicator;
    ncd_id: string;
    ncd_title: string;
    effective_date: string;
    criteria_text: string;
    evidence_requirements: [];
    elm_ref: null;
    elm_version: null;
    relations: [];
  };
}
