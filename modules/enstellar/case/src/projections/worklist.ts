import type { DbClient } from '@sim/outbox-ts';

export interface WorklistEntry {
  case_id: string;
  state: string;
  urgency: 'standard' | 'expedited';
  lob: string;
  member_ref: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Worklist projection — returns open cases (not in terminal states),
 * ordered by (urgency = 'expedited') DESC (expedited first), then created_at ASC (oldest first).
 *
 * RLS is applied at the DB level (sim.tenant_id setting), so we query
 * ens.case directly without an explicit tenant_id predicate in SQL.
 */
export async function getWorklist(client: DbClient): Promise<WorklistEntry[]> {
  const result = await client.query(
    `SELECT c.case_id, c.state, c.urgency, c.lob, c.member_ref, c.created_at, c.updated_at
     FROM ens.case c
     WHERE c.state NOT IN ('determined', 'withdrawn', 'voided')
     ORDER BY (c.urgency = 'expedited') DESC, c.created_at ASC`
  );

  return result.rows.map((r) => ({
    case_id: r['case_id'] as string,
    state: r['state'] as string,
    urgency: r['urgency'] as 'standard' | 'expedited',
    lob: r['lob'] as string,
    member_ref: (r['member_ref'] as string | null) ?? null,
    created_at: r['created_at'] as string,
    updated_at: r['updated_at'] as string,
  }));
}
