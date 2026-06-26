import {
  proxyActivities,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

export interface AnalysisInput {
  analysis_id: string;
  tenant_id: string;
  case_ref: string;
  document_refs: string[];
  member_ref?: string | undefined;
  service_code?: string | undefined;
  model_binding_ref: string;
  model_binding_version: string;
  prompt_ref: string;
  prompt_version: string;
  cell_boundary: 'pooled' | 'dedicated' | 'enclave';
  document_format?: 'pdf' | 'ccda';
}

export interface AnalysisOutput {
  analysis_id: string;
  status: 'complete' | 'partial' | 'failed';
}

const {
  fetchDocuments,
  parseSegment,
  parseCcda,
  extractEntities,
  fetchEvidenceRequirements,
  mapEvidenceToCriteria,
  summarizeGrounded,
  triageAdvise,
  persistAdvisory,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

export const analysisCompleteSignal = defineSignal<[{ analysis_id: string }]>(
  'analysis_complete',
);

export async function revitalAnalyzeCase(input: AnalysisInput): Promise<AnalysisOutput> {
  const unprocessed: Array<{ ref: string; reason: string }> = [];
  let status: 'complete' | 'partial' | 'failed' = 'complete';

  const docs = await fetchDocuments(input.document_refs, unprocessed, input.tenant_id).catch(
    () => { status = 'partial'; return []; }
  );

  const parseActivity = input.document_format === 'ccda' ? parseCcda : parseSegment;

  const spans = docs.length > 0
    ? await parseActivity(docs, input.tenant_id).catch(() => { status = 'partial'; return {}; })
    : {};

  const extracted = await extractEntities(spans, input).catch(
    () => { status = 'partial'; return null; }
  );

  const requirements = input.service_code
    ? await fetchEvidenceRequirements(input.service_code).catch(() => null)
    : null;

  const completenessResult = extracted && requirements
    ? await mapEvidenceToCriteria(extracted, requirements).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  const summaryResult = Object.keys(spans as object).length > 0
    ? await summarizeGrounded(spans, completenessResult, input).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  const triageResult = summaryResult
    ? await triageAdvise(summaryResult, completenessResult, input).catch(
        () => { status = 'partial'; return null; }
      )
    : null;

  await persistAdvisory({
    analysis_id: input.analysis_id,
    tenant_id: input.tenant_id,
    case_ref: input.case_ref,
    document_refs: input.document_refs,
    member_ref: input.member_ref,
    model_binding_ref: input.model_binding_ref,
    model_binding_version: input.model_binding_version,
    prompt_ref: input.prompt_ref,
    prompt_version: input.prompt_version,
    status,
    summary: summaryResult,
    extraction: extracted,
    completeness: completenessResult,
    triage: triageResult,
    unprocessed,
    advisory_type: input.document_format === 'ccda' ? 'claims_attachment' : 'pa',
  });

  return { analysis_id: input.analysis_id, status };
}
