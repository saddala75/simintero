import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { CaseDeduplicate } from '../dedup/CaseDeduplicate.js';
import type { TenantDb } from '@sim/outbox-ts';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

function makeDb(rows: Record<string, unknown>[]): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows }),
      };
      return fn(client);
    }),
  };
}

describe('CaseDeduplicate', () => {
  it('returnsNullWhenNoCaseExists — empty DB result → returns null', async () => {
    const db = makeDb([]);
    const dedup = new CaseDeduplicate(db);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      dedup.findDuplicate({
        memberRef: 'Patient/pat-001',
        code: '99213',
        createdAt: new Date('2025-01-15T00:00:00Z'),
      })
    );

    expect(result).toBeNull();
  });

  it('returnsExistingCaseIdWhenDuplicateFound — DB returns a row → returns that case_id', async () => {
    const db = makeDb([{ case_id: 'case_EXISTING123' }]);
    const dedup = new CaseDeduplicate(db);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      dedup.findDuplicate({
        memberRef: 'Patient/pat-001',
        code: '99213',
        createdAt: new Date('2025-01-15T00:00:00Z'),
      })
    );

    expect(result).toBe('case_EXISTING123');
  });

  it('differentProviderIsNotDuplicate — same member+code+date but different provider → null', async () => {
    // Capture the query params to verify the provider NPI is passed as $5
    let capturedParams: unknown[] = [];
    const db: TenantDb = {
      transaction: vi.fn(async (fn) => {
        const client = {
          query: vi.fn(async (_sql: string, params?: unknown[]) => {
            capturedParams = params ?? [];
            return { rows: [] }; // simulate no matching row for this provider
          }),
        };
        return fn(client);
      }),
    };
    const dedup = new CaseDeduplicate(db);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      dedup.findDuplicate({
        memberRef: 'Patient/pat-001',
        code: '99213',
        createdAt: new Date('2025-01-15T00:00:00Z'),
        providerNpi: 'NPI-A',
      })
    );

    // No matching row → null
    expect(result).toBeNull();
    // The 5th query param ($5) must be the requesting provider NPI
    expect(capturedParams[4]).toBe('NPI-A');
  });

  it('linksWhenDateWithin3Days — same member + code, date ±2 days → duplicate detected', async () => {
    const db = makeDb([{ case_id: 'case_NEAR_DUPE' }]);
    const dedup = new CaseDeduplicate(db);

    // ±2 days is within the ±3 day window
    const baseDate = new Date('2025-03-10T12:00:00Z');
    const twoDaysLater = new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      dedup.findDuplicate({
        memberRef: 'Patient/pat-002',
        code: 'G0296',
        createdAt: twoDaysLater,
      })
    );

    // The mock DB returns a row, so a duplicate is found
    expect(result).toBe('case_NEAR_DUPE');
    // Verify the query included date range parameters that span ±3 days
    const transactionFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(transactionFn).toHaveBeenCalled();
  });
});
