import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { worklist } from '../resolvers/worklist.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['reviewer'],
  principal_type: 'human' as const,
};

const CASE_ROWS = [
  {
    case_id: 'case-uuid-001',
    state: 'clinical_review',
    urgency: 'expedited',
    lob: 'MA',
    member_ref: 'Patient/pat-001',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
  },
  {
    case_id: 'case-uuid-002',
    state: 'pend_rfi',
    urgency: 'standard',
    lob: 'MA',
    member_ref: null,
    created_at: '2024-01-03T00:00:00.000Z',
    updated_at: '2024-01-03T00:00:00.000Z',
  },
];

function makeDb(
  capturedSql: string[] = [],
  capturedParams: unknown[][] = []
): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          capturedSql.push(sql);
          capturedParams.push(params ?? []);

          if (sql.includes('COUNT')) {
            return { rows: [{ total: '2' }] };
          }
          // Return 2 rows for the main SELECT
          return { rows: CASE_ROWS };
        }),
      };
      return fn(client);
    }),
  };
}

describe('worklist resolver', () => {
  it('returns edges array with 2 items when DB returns 2 rows', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      worklist(db, { first: 20 })
    );

    expect(result.edges).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it('maps DB rows to CaseSummary nodes correctly', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      worklist(db, { first: 20 })
    );

    const first = result.edges[0];
    expect(first).toBeDefined();
    expect(first!.node.caseId).toBe('case-uuid-001');
    expect(first!.node.state).toBe('clinical_review');
    expect(first!.node.urgency).toBe('expedited');
    expect(first!.node.lob).toBe('MA');
    expect(first!.node.memberRef).toBe('Patient/pat-001');

    const second = result.edges[1];
    expect(second).toBeDefined();
    expect(second!.node.memberRef).toBeNull();
  });

  it('encodes cursor as base64 of created_at', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      worklist(db, { first: 20 })
    );

    const edge = result.edges[0]!;
    const decoded = Buffer.from(edge.cursor, 'base64').toString('utf-8');
    expect(decoded).toBe('2024-01-01T00:00:00.000Z');
  });

  it('ctx() is called — throws without tenant context', async () => {
    const db = makeDb();
    // Call worklist outside withTenantContext — ctx() should throw
    await expect(worklist(db, {})).rejects.toThrow('No tenant context');
  });

  it('SQL queries do NOT hardcode tenant_id (relies on RLS via GUC)', async () => {
    const capturedSql: string[] = [];
    const db = makeDb(capturedSql);

    await withTenantContext(TEST_CONTEXT, () => worklist(db, { first: 20 }));

    expect(capturedSql.length).toBeGreaterThan(0);
    capturedSql.forEach((sql) => {
      expect(sql).not.toMatch(/tenant_id\s*=/i);
      expect(sql).not.toContain("'t_test'");
    });
  });

  it('respects state/urgency/lob filters by adding WHERE clauses', async () => {
    const capturedSql: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSql, capturedParams);

    await withTenantContext(TEST_CONTEXT, () =>
      worklist(db, { state: 'clinical_review', urgency: 'expedited', lob: 'MA' })
    );

    const rowsSql = capturedSql.find((s) => s.includes('ORDER BY'));
    expect(rowsSql).toBeDefined();
    // All three filter params should appear in some query
    const allParams = capturedParams.flat();
    expect(allParams).toContain('clinical_review');
    expect(allParams).toContain('expedited');
    expect(allParams).toContain('MA');
  });

  it('respects first parameter as page size limit', async () => {
    // Return exactly 3 rows for a first=2 request (limit+1 check)
    const db: TenantDb = {
      transaction: vi.fn(async (fn) => {
        const client = {
          query: vi.fn(async (sql: string) => {
            if (sql.includes('COUNT')) return { rows: [{ total: '3' }] };
            return {
              rows: [
                { ...CASE_ROWS[0] },
                { ...CASE_ROWS[1] },
                { ...CASE_ROWS[0], case_id: 'case-uuid-003' },
              ],
            };
          }),
        };
        return fn(client);
      }),
    };

    const result = await withTenantContext(TEST_CONTEXT, () =>
      worklist(db, { first: 2 })
    );

    expect(result.edges).toHaveLength(2);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.endCursor).toBeDefined();
  });
});
