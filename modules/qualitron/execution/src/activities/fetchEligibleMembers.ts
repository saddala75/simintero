import type { PoolClient } from 'pg';

/** The denominator population: distinct member_refs of Patient resources in the tenant. */
export async function fetchEligibleMembers(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ member_ref: string }>(
    `SELECT DISTINCT member_ref FROM fabric.resource
     WHERE tenant_id = current_setting('sim.tenant_id', true)
       AND resource_type = 'Patient' AND member_ref IS NOT NULL
       AND source <> 'ai-extraction'
     ORDER BY member_ref`,
  );
  return rows.map((r) => r.member_ref);
}
