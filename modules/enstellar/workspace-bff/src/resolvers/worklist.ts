import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface CaseSummary {
  caseId: string;
  state: string;
  urgency: string;
  lob: string;
  memberRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorklistEdge {
  node: CaseSummary;
  cursor: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface WorklistResult {
  edges: WorklistEdge[];
  pageInfo: PageInfo;
  totalCount: number;
}

export interface WorklistArgs {
  state?: string;
  urgency?: string;
  lob?: string;
  first?: number;
  after?: string;
}

/**
 * Worklist resolver — queries ens.case using RLS (GUC sim.tenant_id set by TenantDb connection).
 * Does NOT add explicit tenant_id predicate — RLS handles tenant isolation.
 * Supports cursor pagination (cursor = base64 of created_at).
 */
export async function worklist(db: TenantDb, args: WorklistArgs): Promise<WorklistResult> {
  void ctx(); // validates tenant context; RLS filters by GUC sim.tenant_id

  const limit = Math.min(args.first ?? 20, 100);

  return db.transaction(async (client) => {
    // Build filter conditions (no tenant_id — RLS handles it)
    const filterConditions: string[] = [];
    const filterParams: unknown[] = [];
    let paramIdx = 1;

    if (args.state !== undefined) {
      filterConditions.push(`c.state = $${paramIdx++}`);
      filterParams.push(args.state);
    }
    if (args.urgency !== undefined) {
      filterConditions.push(`c.urgency = $${paramIdx++}`);
      filterParams.push(args.urgency);
    }
    if (args.lob !== undefined) {
      filterConditions.push(`c.lob = $${paramIdx++}`);
      filterParams.push(args.lob);
    }

    const filterWhere =
      filterConditions.length > 0 ? `WHERE ${filterConditions.join(' AND ')}` : '';

    // Total count (without cursor condition)
    const countResult = await client.query(
      `SELECT COUNT(*) AS total FROM ens.case c ${filterWhere}`,
      filterParams
    );
    const totalCount = parseInt(
      (countResult.rows[0]?.['total'] as string | undefined) ?? '0',
      10
    );

    // Cursor condition (keyset pagination on created_at)
    const pageConditions = [...filterConditions];
    const pageParams: unknown[] = [...filterParams];

    if (args.after !== undefined) {
      const afterCreatedAt = Buffer.from(args.after, 'base64').toString('utf-8');
      pageConditions.push(`c.created_at > $${paramIdx++}`);
      pageParams.push(afterCreatedAt);
    }

    const pageWhere =
      pageConditions.length > 0 ? `WHERE ${pageConditions.join(' AND ')}` : '';

    // Fetch limit + 1 to determine hasNextPage
    pageParams.push(limit + 1);
    const rowsResult = await client.query(
      `SELECT c.case_id, c.state, c.urgency, c.lob, c.member_ref,
              c.created_at, c.updated_at
       FROM ens.case c
       ${pageWhere}
       ORDER BY (c.urgency = 'expedited') DESC, c.created_at ASC
       LIMIT $${paramIdx}`,
      pageParams
    );

    const rows = rowsResult.rows;
    const hasNextPage = rows.length > limit;
    const slicedRows = hasNextPage ? rows.slice(0, limit) : rows;

    const edges: WorklistEdge[] = slicedRows.map((r) => {
      const createdAt = r['created_at'] as string;
      return {
        node: {
          caseId: r['case_id'] as string,
          state: r['state'] as string,
          urgency: r['urgency'] as string,
          lob: r['lob'] as string,
          memberRef: (r['member_ref'] as string | null | undefined) ?? null,
          createdAt,
          updatedAt: r['updated_at'] as string,
        },
        cursor: Buffer.from(createdAt).toString('base64'),
      };
    });

    const lastRow = slicedRows[slicedRows.length - 1];
    const endCursor = lastRow
      ? Buffer.from(lastRow['created_at'] as string).toString('base64')
      : null;

    return {
      edges,
      pageInfo: { hasNextPage, endCursor },
      totalCount,
    };
  });
}
