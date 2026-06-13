import {
  proxyActivities,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import type * as activities from '../activities/index.js';

export interface AnalysisInput {
  analysis_id: string;
  case_ref: string;
  document_refs: string[];
  evidence_requirements_ref: string | null;
  model_binding_ref: string;
  model_binding_version: string;
  prompt_ref: string;
  prompt_version: string;
  cell_boundary: 'pooled' | 'dedicated' | 'enclave';
}

export interface AnalysisOutput {
  analysis_id: string;
  status: 'complete' | 'partial' | 'failed';
}

const {
  fetchDocuments,
  parseSegment,
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

  const docs = await fetchDocuments(input.document_refs, unprocessed).catch(
    () => { status = 'partial'; return []; }
  );

  const spans = docs.length > 0
    ? await parseSegment(docs).catch(() => { status = 'partial'; return {}; })
    : {};

  const extracted = await extractEntities(spans, input).catch(
    () => { status = 'partial'; return null; }
  );

  const requirements = input.evidence_requirements_ref
    ? await fetchEvidenceRequirements(input.evidence_requirements_ref, input.case_ref).catch(
        () => { status = 'partial'; return null; }
      )
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
    case_ref: input.case_ref,
    status,
    summary: summaryResult,
    extraction: extracted,
    completeness: completenessResult,
    triage: triageResult,
    unprocessed,
  });

  return { analysis_id: input.analysis_id, status };
}
