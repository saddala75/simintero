import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { satisfyRFI } from '../commands/SatisfyRFI.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

function makeDb(
  rfiRowCount: number,
  captured: Array<{ sql: string; params: unknown[] }> = []
): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          captured.push({ sql, params: params ?? [] });
          if (sql.includes('pg_advisory_xact_lock')) {
            return { rows: [] };
          }
          if (sql.includes('UPDATE ens.rfi')) {
            return { rows: [], rowCount: rfiRowCount };
          }
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

const BASE_INPUT = {
  caseId: 'case-uuid-001',
  rfiId: 'rfi-uuid-001',
  satisfiedBy: [{ type: 'document', ref: 'doc/001' }],
};

describe('SatisfyRFI', () => {
  it('throws when the RFI is not found or not open (rowCount = 0)', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(0, captured);

    await expect(
      withTenantContext(TEST_CONTEXT, () => satisfyRFI(db, BASE_INPUT))
    ).rejects.toThrow(`RFI ${BASE_INPUT.rfiId} not found or not open`);

    // No outbox insert must have occurred
    const outboxInsert = captured.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeUndefined();
  });

  it('emits RfiSatisfied event and outbox entry when RFI is found and open', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(1, captured);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      satisfyRFI(db, BASE_INPUT)
    );

    expect(result.rfiId).toBe(BASE_INPUT.rfiId);

    const caseEventInsert = captured.find((q) =>
      q.sql.includes('INSERT INTO ens.case_event')
    );
    expect(caseEventInsert).toBeDefined();
    expect(caseEventInsert!.sql).toContain('RfiSatisfied');

    const outboxInsert = captured.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeDefined();
  });

  it('acquires advisory lock keyed on caseId as the first query', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(1, captured);

    await withTenantContext(TEST_CONTEXT, () => satisfyRFI(db, BASE_INPUT));

    expect(captured[0]!.sql).toContain('pg_advisory_xact_lock');
    expect(captured[0]!.params).toContain(BASE_INPUT.caseId);
  });
});
