import { type RevitalClient, DefaultRevitalClient } from '../clients/RevitalClient.js';

export interface RequestAdvisoryAnalysisInput {
  caseId: string;
  documentRefs: string[];
  lob: string;
  urgency: 'standard' | 'expedited';
}

export interface AdvisoryTrackingResult {
  analysis_id: string;
  status: 'accepted' | 'not_available';
}

let revitalClient: RevitalClient = new DefaultRevitalClient();

export function setRevitalClient(client: RevitalClient): void {
  revitalClient = client;
}

export async function requestAdvisoryAnalysis(
  input: RequestAdvisoryAnalysisInput,
): Promise<AdvisoryTrackingResult | null> {
  try {
    const accepted = await revitalClient.requestAnalysis({
      case_ref: input.caseId,
      analysis_kinds: ['summary', 'extraction', 'completeness', 'triage'],
      inputs: {
        document_refs: input.documentRefs,
        case_context: { lob: input.lob, urgency: input.urgency, service_lines: [] },
      },
      priority: 'interactive',
    });
    return { analysis_id: accepted.analysis_id, status: 'accepted' };
  } catch {
    return null;  // Non-critical — advisory is advisory-only; workflow continues
  }
}
