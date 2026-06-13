import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface ArtifactPin {
  canonicalUrl: string;
  version: string;
}

export interface LinkedCases {
  appealOf: string | null;
  relatedCases: string[];
}

export interface ServiceLine {
  lineId: string;
  code: string;
  qty: number;
  status: string;
}

export interface Determination {
  determinationId: string;
  outcome: string;
  decidedBy: string;
  decidedAt: string;
}

export interface Rfi {
  rfiId: string;
  status: string;
  dueBy: string;
}

export interface CaseDetailResult {
  caseId: string;
  state: string;
  urgency: string;
  lob: string;
  channel: string;
  memberRef: string | null;
  coverageRef: string | null;
  pins: ArtifactPin[];
  linked: LinkedCases;
  serviceLines: ServiceLine[];
  determinations: Determination[];
  rfis: Rfi[];
}

/**
 * CaseDetail resolver — JOINs ens.case + ens.service_line + ens.determination + ens.rfi.
 * RLS enforced at DB level; no explicit tenant_id predicate.
 */
export async function caseDetail(
  db: TenantDb,
  caseId: string
): Promise<CaseDetailResult | null> {
  void ctx(); // validates tenant context; RLS filters by GUC sim.tenant_id

  return db.transaction(async (client) => {
    const caseResult = await client.query(
      `SELECT case_id, state, urgency, lob, channel,
              member_ref, coverage_ref, pins, linked
       FROM ens.case
       WHERE case_id = $1`,
      [caseId]
    );

    const caseRow = caseResult.rows[0];
    if (!caseRow) {
      return null;
    }

    const slResult = await client.query(
      `SELECT line_id, code, qty, status
       FROM ens.service_line
       WHERE case_id = $1
       ORDER BY line_id`,
      [caseId]
    );

    const detResult = await client.query(
      `SELECT determination_id, outcome, decided_by, decided_at
       FROM ens.determination
       WHERE case_id = $1
       ORDER BY decided_at DESC`,
      [caseId]
    );

    const rfiResult = await client.query(
      `SELECT rfi_id, status, due_by
       FROM ens.rfi
       WHERE case_id = $1
       ORDER BY due_by ASC`,
      [caseId]
    );

    // Parse pins JSONB (stored as array of {canonical_url, version})
    const rawPins = (caseRow['pins'] as Array<Record<string, unknown>> | null | undefined) ?? [];
    const pins: ArtifactPin[] = Array.isArray(rawPins)
      ? rawPins.map((p) => ({
          canonicalUrl: p['canonical_url'] as string,
          version: p['version'] as string,
        }))
      : [];

    // Parse linked JSONB
    const rawLinked = (caseRow['linked'] as Record<string, unknown> | null | undefined) ?? {};
    const linked: LinkedCases = {
      appealOf: (rawLinked['appeal_of'] as string | null | undefined) ?? null,
      relatedCases: (rawLinked['related_cases'] as string[] | undefined) ?? [],
    };

    const serviceLines: ServiceLine[] = slResult.rows.map((r) => ({
      lineId: r['line_id'] as string,
      code: String(r['code']),
      qty: r['qty'] as number,
      status: r['status'] as string,
    }));

    const determinations: Determination[] = detResult.rows.map((r) => ({
      determinationId: r['determination_id'] as string,
      outcome: r['outcome'] as string,
      decidedBy: String(r['decided_by']),
      decidedAt: r['decided_at'] as string,
    }));

    const rfis: Rfi[] = rfiResult.rows.map((r) => ({
      rfiId: r['rfi_id'] as string,
      status: r['status'] as string,
      dueBy: r['due_by'] as string,
    }));

    return {
      caseId: caseRow['case_id'] as string,
      state: caseRow['state'] as string,
      urgency: caseRow['urgency'] as string,
      lob: caseRow['lob'] as string,
      channel: caseRow['channel'] as string,
      memberRef: (caseRow['member_ref'] as string | null | undefined) ?? null,
      coverageRef: (caseRow['coverage_ref'] as string | null | undefined) ?? null,
      pins,
      linked,
      serviceLines,
      determinations,
      rfis,
    };
  });
}
