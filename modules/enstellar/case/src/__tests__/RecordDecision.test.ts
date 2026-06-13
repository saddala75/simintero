import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

// We mock authorize before importing RecordDecision so the module sees the mock
vi.mock('@sim/authz-client-ts', () => ({
  authorize: vi.fn(),
}));

import { authorize } from '@sim/authz-client-ts';
import { recordDecision } from '../commands/RecordDecision.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['medical_director'],
  principal_type: 'human' as const,
};

const SERVICE_CONTEXT = {
  ...TEST_CONTEXT,
  roles: ['service'],
  principal_type: 'service' as const,
};

function makeDb(
  capturedQueries: Array<{ sql: string; params: unknown[] }> = []
): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          capturedQueries.push({ sql, params: params ?? [] });
          // Return a fake seq=1 for the COALESCE query
          if (sql.includes('COALESCE(MAX(seq)')) {
            return { rows: [{ next_seq: 2 }] };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('RecordDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws SIM-AUTHZ-0001 when authorize() is denied — no DB write occurs', async () => {
    const authzError = Object.assign(new Error('Forbidden'), {
      code: 'SIM-AUTHZ-0001',
      status: 403,
    });
    (authorize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(authzError);

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);

    await expect(
      withTenantContext(TEST_CONTEXT, () =>
        recordDecision(db, {
          caseId: 'case-uuid-001',
          outcome: 'denied',
          decidedBy: { type: 'service', id: 'auto-engine' },
          rationaleRef: null,
          rulesTraceRef: null,
        })
      )
    ).rejects.toMatchObject({ code: 'SIM-AUTHZ-0001', status: 403 });

    // db.transaction MUST NOT have been called — authorize throws first
    const txFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(txFn).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it('inserts determination when authorize() resolves', async () => {
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      recordDecision(db, {
        caseId: 'case-uuid-001',
        outcome: 'approved',
        decidedBy: { type: 'human', id: 'user-md-001', role: 'medical_director' },
        rationaleRef: 'rationale/001',
        rulesTraceRef: 'trace/001',
      })
    );

    expect(result.determinationId).toBeDefined();
    const detInsert = queries.find((q) => q.sql.includes('ens.determination'));
    expect(detInsert).toBeDefined();
    // outcome should be in the params
    expect(detInsert!.params).toContain('approved');
  });

  it('blocks denied outcome with service principal — mock OPA returns false', async () => {
    // Simulate OPA policy rejecting a service principal attempting denied outcome
    const authzError = Object.assign(new Error('Forbidden'), {
      code: 'SIM-AUTHZ-0001',
      status: 403,
    });
    (authorize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(authzError);

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);

    await expect(
      withTenantContext(SERVICE_CONTEXT, () =>
        recordDecision(db, {
          caseId: 'case-uuid-001',
          outcome: 'denied',
          decidedBy: { type: 'service', id: 'auto-engine' },
        })
      )
    ).rejects.toMatchObject({ code: 'SIM-AUTHZ-0001' });

    // authorize must have been called with the correct action
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'adverse_action' }),
      'sim/guards/adverse_action/allow'
    );
    // No DB writes
    expect(queries).toHaveLength(0);
  });

  it('emits DeterminationRecorded event to case_event and outbox', async () => {
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);

    await withTenantContext(TEST_CONTEXT, () =>
      recordDecision(db, {
        caseId: 'case-uuid-001',
        outcome: 'approved',
        decidedBy: { type: 'human', id: 'user-md-001' },
        rationaleRef: 'rationale/001',
        rulesTraceRef: 'trace/001',
      })
    );

    const eventInsert = queries.find(
      (q) => q.sql.includes('INSERT INTO ens.case_event')
    );
    expect(eventInsert).toBeDefined();
    // event_type = DeterminationRecorded is passed as a literal in the INSERT SQL
    expect(eventInsert!.sql).toContain('DeterminationRecorded');

    const outboxInsert = queries.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeDefined();
  });
});
