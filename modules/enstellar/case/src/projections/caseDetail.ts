import type { DbClient } from '@sim/outbox-ts';

export interface ServiceLine {
  line_id: string;
  code: Record<string, unknown>;
  qty: number;
  units: string;
  status: string;
}

export interface Determination {
  determination_id: string;
  outcome: string;
  decided_by: Record<string, unknown>;
  auto_path: boolean;
  decided_at: string;
  rationale_ref: string | null;
}

export interface CaseDetailResult {
  case_id: string;
  tenant_id: string;
  state: string;
  urgency: string;
  channel: string;
  lob: string;
  member_ref: string | null;
  coverage_ref: string | null;
  origin: Record<string, unknown>;
  providers: Record<string, unknown>;
  pins: Record<string, unknown>;
  linked: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  service_lines: ServiceLine[];
  determinations: Determination[];
}

/**
 * Case detail projection — full case row + service lines + determinations.
 * RLS enforced at DB level.
 */
export async function getCaseDetail(
  client: DbClient,
  caseId: string
): Promise<CaseDetailResult | null> {
  const caseResult = await client.query(
    `SELECT case_id, tenant_id, state, urgency, channel, lob,
            member_ref, coverage_ref, origin, providers, pins, linked,
            created_at, updated_at
     FROM ens.case
     WHERE case_id = $1`,
    [caseId]
  );

  const caseRow = caseResult.rows[0];
  if (!caseRow) {
    return null;
  }

  const slResult = await client.query(
    `SELECT line_id, code, qty, units, status
     FROM ens.service_line
     WHERE case_id = $1
     ORDER BY line_id`,
    [caseId]
  );

  const detResult = await client.query(
    `SELECT determination_id, outcome, decided_by, auto_path, decided_at, rationale_ref
     FROM ens.determination
     WHERE case_id = $1
     ORDER BY decided_at DESC`,
    [caseId]
  );

  return {
    case_id: caseRow['case_id'] as string,
    tenant_id: caseRow['tenant_id'] as string,
    state: caseRow['state'] as string,
    urgency: caseRow['urgency'] as string,
    channel: caseRow['channel'] as string,
    lob: caseRow['lob'] as string,
    member_ref: (caseRow['member_ref'] as string | null) ?? null,
    coverage_ref: (caseRow['coverage_ref'] as string | null) ?? null,
    origin: (caseRow['origin'] as Record<string, unknown>) ?? {},
    providers: (caseRow['providers'] as Record<string, unknown>) ?? {},
    pins: (caseRow['pins'] as Record<string, unknown>) ?? [],
    linked: (caseRow['linked'] as Record<string, unknown>) ?? {},
    created_at: caseRow['created_at'] as string,
    updated_at: caseRow['updated_at'] as string,
    service_lines: slResult.rows.map((r) => ({
      line_id: r['line_id'] as string,
      code: r['code'] as Record<string, unknown>,
      qty: r['qty'] as number,
      units: r['units'] as string,
      status: r['status'] as string,
    })),
    determinations: detResult.rows.map((r) => ({
      determination_id: r['determination_id'] as string,
      outcome: r['outcome'] as string,
      decided_by: r['decided_by'] as Record<string, unknown>,
      auto_path: r['auto_path'] as boolean,
      decided_at: r['decided_at'] as string,
      rationale_ref: (r['rationale_ref'] as string | null) ?? null,
    })),
  };
}
