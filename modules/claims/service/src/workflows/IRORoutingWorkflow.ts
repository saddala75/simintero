import type { Pool } from 'pg';

// HUMAN_REVIEW: IRO assignment logic requires compliance and legal review before production
// IRO_VENDOR_ID is configurable via env — never hardcode a vendor or tenant-specific routing rule
// Read lazily at call time so the env var can be changed at runtime (e.g., in tests or hot config reload)
function getIROVendorId(): string {
  return process.env['IRO_VENDOR_ID'] ?? 'iro-stub'; // HUMAN_REVIEW
}

export async function iroRoutingWorkflow(
  appealCaseRef: string,
  tenantId: string,
  pool: Pool,
): Promise<void> {
  // Emit iro.referral outbox event — payload: IDs only, no clinical content
  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     VALUES ($1, 'sim.claims.iro', $2)`,
    [tenantId, JSON.stringify({
      event_type: 'IROReferred',
      appeal_case_ref: appealCaseRef,
      iro_vendor_id: getIROVendorId(),
    })],
  );

  // Update ens.case status to IRO_PENDING
  await pool.query(
    `UPDATE ens.case SET state = 'IRO_PENDING', updated_at = NOW()
     WHERE case_id = $1::uuid AND tenant_id = $2`,
    [appealCaseRef, tenantId],
  );
}
