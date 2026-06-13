import { useState, useEffect } from 'react';
import type { CaseListItem, ServiceLine } from '../types.js';
import { gqlRequest } from '../api/client.js';
import { useSimCtx } from '../api/context.js';
import { CASE_DETAIL_QUERY } from '../graphql/queries.js';

export interface CaseDetail extends CaseListItem {
  service_lines: ServiceLine[];
}

interface BffServiceLine {
  lineId: string;
  code: string;
  qty: number;
  status: string;
}

interface BffCaseDetail {
  caseId: string;
  urgency: string;
  state: string;
  memberRef: string | null;
  lob: string;
  serviceLines: BffServiceLine[];
}

interface CaseDetailData {
  case: BffCaseDetail | null;
}

export function useCaseDetail(caseId: string) {
  const ctx = useSimCtx();
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCaseDetail(null);

    gqlRequest<CaseDetailData>(CASE_DETAIL_QUERY, { caseId }, ctx)
      .then(data => {
        if (cancelled || !data.case) return;
        const bff = data.case;
        setCaseDetail({
          case_id: bff.caseId,
          urgency: bff.urgency as CaseDetail['urgency'],
          state: bff.state as CaseDetail['state'],
          member_ref: bff.memberRef ?? '',
          lob: bff.lob,
          service_lines: bff.serviceLines.map(l => ({
            line_id: l.lineId,
            code: { code: l.code, system: 'CPT' },
            qty: l.qty,
            status: l.status,
          })),
        });
      })
      .catch(err => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [caseId, ctx.tenant_id]);

  return { caseDetail, loading, error };
}
