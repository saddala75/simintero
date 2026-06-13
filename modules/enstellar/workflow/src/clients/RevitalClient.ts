// C-2 analysis request/response shapes
export interface AnalysisRequest {
  case_ref: string;
  analysis_kinds: Array<'summary' | 'extraction' | 'completeness' | 'triage'>;
  inputs: {
    document_refs: string[];
    case_context: { lob: string; urgency: string; service_lines: unknown[] };
  };
  priority?: 'interactive' | 'batch';
}

export interface AnalysisAccepted {
  analysis_id: string;
  operation: string;
}

export interface AdvisoryResult {
  analysis_id: string;
  classification: 'advisory';
  status: 'complete' | 'partial' | 'failed';
  case_ref: string;
  summary?: {
    status: 'ok' | 'abstained';
    assertions?: Array<{
      id: string;
      text: string;
      citations: Array<{ document_ref: string; page: number; region: number[]; excerpt_hash: string; trace_ref: string }>;
      confidence: number;
    }>;
  };
  triage?: { status: 'ok' | 'abstained'; suggestion?: string; confidence?: number };
}

export interface RevitalClient {
  requestAnalysis(req: AnalysisRequest): Promise<AnalysisAccepted>;
  getAnalysis(analysisId: string): Promise<AdvisoryResult>;
}

export class DefaultRevitalClient implements RevitalClient {
  private readonly baseUrl: string;
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env['REVITAL_URL'] ?? 'http://localhost:3050';
  }
  async requestAnalysis(req: AnalysisRequest): Promise<AnalysisAccepted> {
    const res = await fetch(`${this.baseUrl}/v1/assist/analyses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Revital requestAnalysis ${res.status}`);
    return (await res.json()) as AnalysisAccepted;
  }
  async getAnalysis(analysisId: string): Promise<AdvisoryResult> {
    const res = await fetch(`${this.baseUrl}/v1/assist/analyses/${analysisId}`);
    if (!res.ok) throw new Error(`Revital getAnalysis ${res.status}`);
    return (await res.json()) as AdvisoryResult;
  }
}
