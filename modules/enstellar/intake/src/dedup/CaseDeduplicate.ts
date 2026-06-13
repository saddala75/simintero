import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface DeduplicateParams {
  memberRef: string;
  code: string;
  createdAt: Date;
  providerNpi?: string;
}

/**
 * Checks for an existing case that matches (memberRef, provider, first service line code)
 * with a requested date within ±3 days. Returns the existing case_id or null.
 */
export class CaseDeduplicate {
  constructor(private readonly db: TenantDb) {}

  async findDuplicate(params: DeduplicateParams): Promise<string | null> {
    const { memberRef, code, createdAt, providerNpi } = params;
    // Use ctx() for tenant isolation — never pass tenant_id as a param
    void ctx(); // validates context is present

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const lower = new Date(createdAt.getTime() - threeDaysMs);
    const upper = new Date(createdAt.getTime() + threeDaysMs);

    let result: string | null = null;

    await this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT c.case_id
         FROM ens.case c
         JOIN ens.service_line sl ON sl.case_id = c.case_id
         WHERE c.member_ref = $1
           AND sl.code->>'code' = $2
           AND COALESCE((c.origin->>'receivedAt')::timestamptz, c.created_at) BETWEEN $3 AND $4
           AND ($5::text IS NULL OR c.providers->>'requestingNpi' = $5)
         ORDER BY c.created_at ASC
         LIMIT 1`,
        [memberRef, code, lower.toISOString(), upper.toISOString(), providerNpi ?? null]
      );

      if (rows.length > 0) {
        result = String(rows[0]!['case_id']);
      }
    });

    return result;
  }
}
