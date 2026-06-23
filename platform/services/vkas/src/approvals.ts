import type { PoolClient } from "pg";

export interface ApprovalInput {
  canonicalUrl: string;
  version: string;
  gate: string;
  approver: string;
  decided: string;
  rationale?: string | null;
  attestation?: Record<string, unknown> | null;
}

/**
 * Upsert a row into vkas.approval.
 * Uses ON CONFLICT so a re-run of the eval-runner overwrites stale results.
 */
export async function recordApproval(
  client: PoolClient,
  a: ApprovalInput,
): Promise<void> {
  await client.query(
    `INSERT INTO vkas.approval
       (canonical_url, version, gate, approver, decided, rationale, attestation, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
     ON CONFLICT (canonical_url, version, gate)
     DO UPDATE SET
       approver    = EXCLUDED.approver,
       decided     = EXCLUDED.decided,
       rationale   = EXCLUDED.rationale,
       attestation = EXCLUDED.attestation,
       decided_at  = now()`,
    [
      a.canonicalUrl,
      a.version,
      a.gate,
      a.approver,
      a.decided,
      a.rationale ?? null,
      JSON.stringify(a.attestation ?? {}),
    ],
  );
}
