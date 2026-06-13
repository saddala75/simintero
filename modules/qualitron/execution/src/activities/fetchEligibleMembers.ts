import type { Pool } from 'pg';

export async function fetchEligibleMembers(
  pool: Pool,
  periodStart: string,
  periodEnd: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ member_id: string }>(
    `SELECT DISTINCT member_id
     FROM ens.case
     WHERE tenant_id = current_setting('sim.tenant_id', true)
       AND period_start <= $1
       AND period_end >= $2
       AND status IN ('DETERMINED', 'CLOSED')`,
    [periodEnd, periodStart],
  );
  return rows.map((r) => r.member_id);
}
