import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { ArtifactCacheInvalidator } from '../invalidation/ArtifactCacheInvalidator.js';
import type { TenantDb } from '@sim/outbox-ts';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['DIG'] },
  roles: [],
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
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('ArtifactCacheInvalidator', () => {
  it('deletes cache entries for canonical_url on ArtifactActivated event', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);
    const invalidator = new ArtifactCacheInvalidator(db);

    await withTenantContext(TEST_CONTEXT, () =>
      invalidator.handleArtifactActivated({
        canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
      })
    );

    // Verify a DELETE was issued
    const deleteQuery = queries.find((q) =>
      q.sql.toLowerCase().includes('delete')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.params).toContain(
      'urn:sim:policy:knee-arthroscopy:1.0.0'
    );

    // Verify the DELETE targeted the correct table
    expect(deleteQuery!.sql).toMatch(/dig\.artifact_cache/);

    // Verify DELETE was wrapped in a transaction
    const transactionFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(transactionFn).toHaveBeenCalledOnce();
  });

  it('uses parameterized query — canonical_url passed as $1 placeholder', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb(queries);
    const invalidator = new ArtifactCacheInvalidator(db);

    const canonical = 'urn:sim:policy:knee-arthroscopy:1.0.0';

    await withTenantContext(TEST_CONTEXT, () =>
      invalidator.handleArtifactActivated({ canonical_url: canonical })
    );

    const deleteQuery = queries.find((q) =>
      q.sql.toLowerCase().includes('delete')
    );
    expect(deleteQuery).toBeDefined();
    // SQL must use placeholder, not interpolation
    expect(deleteQuery!.sql).toContain('$1');
    expect(deleteQuery!.params[0]).toBe(canonical);
  });

  it('ctx() is enforced — throws when no tenant context is present', async () => {
    const db = makeDb();
    const invalidator = new ArtifactCacheInvalidator(db);

    // Calling without withTenantContext should throw from ctx()
    await expect(
      invalidator.handleArtifactActivated({
        canonical_url: 'urn:sim:policy:knee-arthroscopy:1.0.0',
      })
    ).rejects.toThrow('No tenant context');
  });
});
