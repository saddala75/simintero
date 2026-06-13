import { useState, useEffect, useCallback } from 'react';
import type { CaseListItem } from '../types.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { WORKLIST_QUERY } from '../graphql/queries.js';

interface BffNode {
  caseId: string;
  urgency: string;
  state: string;
  memberRef: string | null;
  lob: string;
}

interface WorklistData {
  worklist: {
    edges: Array<{ node: BffNode; cursor: string }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    totalCount: number;
  };
}

function toListItem(node: BffNode): CaseListItem {
  return {
    case_id: node.caseId,
    urgency: node.urgency as CaseListItem['urgency'],
    state: node.state as CaseListItem['state'],
    member_ref: node.memberRef ?? '',
    lob: node.lob,
  };
}

export function useWorklist(params?: { state?: string; lob?: string }) {
  const ctx = useSimCtx();
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const stateFilter = params?.state ?? null;
  const lobFilter = params?.lob ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCursor(null);
    setCases([]);

    gqlRequest<WorklistData>(
      WORKLIST_QUERY,
      { ...(stateFilter != null && { state: stateFilter }), ...(lobFilter != null && { lob: lobFilter }) },
      ctx,
    )
      .then(data => {
        if (cancelled) return;
        setCases(data.worklist.edges.map(e => toListItem(e.node)));
        setHasMore(data.worklist.pageInfo.hasNextPage);
        setCursor(data.worklist.pageInfo.endCursor ?? null);
      })
      .catch(err => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [stateFilter, lobFilter, ctx.tenant_id]);

  const loadMore = useCallback(() => {
    if (!cursor || !hasMore || loading) return;
    setLoading(true);

    gqlRequest<WorklistData>(
      WORKLIST_QUERY,
      { state: stateFilter, lob: lobFilter, after: cursor },
      ctx,
    )
      .then(data => {
        setCases(prev => [
          ...prev,
          ...data.worklist.edges.map(e => toListItem(e.node)),
        ]);
        setHasMore(data.worklist.pageInfo.hasNextPage);
        setCursor(data.worklist.pageInfo.endCursor ?? null);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [cursor, hasMore, loading, stateFilter, lobFilter, ctx]);

  return { cases, loading, error, loadMore };
}
