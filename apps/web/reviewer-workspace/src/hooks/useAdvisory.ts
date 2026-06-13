import { useState, useEffect } from 'react';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { ADVISORY_QUERY } from '../graphql/queries.js';

interface BffCitation { documentRef: string; page: number }
interface BffAssertion { id: string; text: string; confidence: number; citations: BffCitation[] }
interface BffSummary { status: string; assertions?: BffAssertion[] }
interface BffTriage { status: string; suggestion?: string | null; confidence?: number | null }
interface BffAdvisory {
  status: string;
  analysis_id: string | null;
  result: {
    summary?: BffSummary | null;
    triage?: BffTriage | null;
  } | null;
}

interface AdvisoryData {
  advisory: BffAdvisory;
}

// Shape expected by AdvisoryPanel
export interface AdvisoryResult {
  analysisId: string;
  classification: 'advisory';
  status: 'complete' | 'partial' | 'failed';
  summary?: {
    status: 'ok' | 'abstained';
    assertions?: Array<{
      id: string;
      text: string;
      confidence: number;
      citations: Array<{ documentRef: string; page: number; region: number[]; excerptHash: string }>;
    }>;
    abstainReason?: string | null;
  };
  triage?: {
    status: 'ok' | 'abstained';
    suggestion?: 'likely_meets' | 'needs_rfi' | 'route_to_clinician';
    confidence?: number;
  };
}

function mapAdvisory(bff: BffAdvisory): AdvisoryResult {
  return {
    analysisId: bff.analysis_id ?? '',
    classification: 'advisory',
    status: (bff.status as AdvisoryResult['status']) ?? 'failed',
    summary: bff.result?.summary
      ? {
          status: (bff.result.summary.status as 'ok' | 'abstained') ?? 'abstained',
          assertions: bff.result.summary.assertions?.map(a => ({
            id: a.id,
            text: a.text,
            confidence: a.confidence,
            citations: a.citations.map(c => ({
              documentRef: c.documentRef,
              page: c.page,
              region: [],
              excerptHash: '',
            })),
          })),
        }
      : undefined,
    triage: bff.result?.triage
      ? {
          status: (bff.result.triage.status as 'ok' | 'abstained') ?? 'abstained',
          suggestion: bff.result.triage.suggestion
            ? (bff.result.triage.suggestion as 'likely_meets' | 'needs_rfi' | 'route_to_clinician')
            : undefined,
          confidence: bff.result.triage.confidence ?? undefined,
        }
      : undefined,
  };
}

export function useAdvisory(caseId: string) {
  const ctx = useSimCtx();
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAdvisory(null);

    gqlRequest<AdvisoryData>(ADVISORY_QUERY, { caseId }, ctx)
      .then(data => {
        if (cancelled) return;
        const bff = data.advisory;
        if (bff.status === 'not_available') {
          setAdvisory(null);
        } else {
          setAdvisory(mapAdvisory(bff));
        }
      })
      .catch(err => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [caseId, ctx.tenant_id]);

  return { advisory, loading, error };
}
