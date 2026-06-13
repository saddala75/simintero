import { useState, useEffect } from 'react';
import type { TraceCriterion } from '../types.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { TRACE_QUERY } from '../graphql/queries.js';

interface TraceData {
  trace: { traceRef: string; rules: string[]; raw: string | null } | null;
}

function rulesToCriteria(rules: string[]): TraceCriterion[] {
  return rules.map(rule => ({
    expression_name: rule,
    result: true as const,
    artifact_canonical_url: '',
    artifact_version: '',
  }));
}

function parseRaw(raw: string | null): TraceCriterion[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'criteria' in parsed &&
      Array.isArray((parsed as { criteria: unknown }).criteria)
    ) {
      return (parsed as { criteria: TraceCriterion[] }).criteria;
    }
  } catch {
    // raw is not JSON with criteria — fall through
  }
  return null;
}

export function useRulesTrace(traceRef: string | null) {
  const ctx = useSimCtx();
  const [criteria, setCriteria] = useState<TraceCriterion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceRef) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    gqlRequest<TraceData>(TRACE_QUERY, { traceRef }, ctx)
      .then(data => {
        if (cancelled || !data.trace) return;
        const parsed = parseRaw(data.trace.raw);
        setCriteria(parsed ?? rulesToCriteria(data.trace.rules));
      })
      .catch(err => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [traceRef, ctx.tenant_id]);

  return { criteria, loading, error };
}
