import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { ProcessIntakeCommand } from '../commands/ProcessIntakeCommand.js';
import type { IntakeCommand } from '../commands/ProcessIntakeCommand.js';
import type { TenantDb } from '@sim/outbox-ts';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

const SAMPLE_COMMAND: IntakeCommand = {
  channel: 'PAS',
  caseRef: null,
  rawPayloadRef: 'raw-ref-001',
  receivedAt: '2025-06-01T10:00:00Z',
  memberRef: 'Patient/pat-001',
  coverageRef: 'Coverage/cov-001',
  providers: { requestingNpi: '1234567890' },
  serviceLines: [{ code: '99213', system: 'CPT', qty: 1 }],
  urgency: 'standard',
  externalIds: [],
};

/**
 * Builds a mock TenantDb.
 * - dedupRows: what the dedup SELECT returns (controls duplicate detection)
 * - capturedQueries: collects all SQL + params passed to client.query()
 */
function makeDb(
  dedupRows: Record<string, unknown>[] = [],
  capturedQueries: Array<{ sql: string; params: unknown[] }> = []
): TenantDb {
  let callCount = 0;

  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          capturedQueries.push({ sql, params: params ?? [] });
          callCount++;
          // First transaction is always the dedup SELECT
          if (callCount === 1) {
            return { rows: dedupRows };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('ProcessIntakeCommand', () => {
  it('createsCaseAndEmitsEvent — new intake → case created + CaseCreated outbox entry', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb([], queries);
    const processor = new ProcessIntakeCommand(db);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      processor.execute(SAMPLE_COMMAND)
    );

    expect(result.status).toBe('created');
    // caseId is stored as UUID in ens.case (UUID column type in Phase 0 schema)
    expect(result.caseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Should have called transaction multiple times (dedup + fabric + case+outbox)
    const transactionFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(transactionFn).toHaveBeenCalled();

    // Check that an outbox INSERT was recorded in the main transaction
    const outboxInsert = queries.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeDefined();
  });

  it('haltsBelowThreshold — score < 0.85 creates intake_exception task and throws', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb([], queries);

    // Inject a resolver that returns a low score to exercise the threshold guard
    const lowScoreResolver = {
      resolve: (_ref: string) => ({ memberRef: _ref, method: 'exact_id' as const, score: 0.5 }),
    };
    const processor = new ProcessIntakeCommand(db, lowScoreResolver);

    await expect(
      withTenantContext(TEST_CONTEXT, () => processor.execute(SAMPLE_COMMAND))
    ).rejects.toThrow('Member resolution below threshold');

    // db.transaction must have been called for the ens.task INSERT
    const transactionFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(transactionFn).toHaveBeenCalled();

    // The task INSERT should appear in captured queries
    const taskInsert = queries.find((q) => q.sql.includes('ens.task'));
    expect(taskInsert).toBeDefined();
  });

  it('linksToDuplicateCase — dedup returns existing case → status=linked, no CaseCreated', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb([{ case_id: 'case_EXISTING_ABC' }], queries);
    const processor = new ProcessIntakeCommand(db);

    const result = await withTenantContext(TEST_CONTEXT, () =>
      processor.execute(SAMPLE_COMMAND)
    );

    expect(result.status).toBe('linked');
    expect(result.caseId).toBe('case_EXISTING_ABC');

    // No outbox INSERT should have been executed
    const outboxInsert = queries.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeUndefined();
  });

  it('setsCorrectSchemaRef — emitted event has schema_ref=sim.case.lifecycle/CaseCreated/v1', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb([], queries);
    const processor = new ProcessIntakeCommand(db);

    await withTenantContext(TEST_CONTEXT, () =>
      processor.execute(SAMPLE_COMMAND)
    );

    const outboxInsert = queries.find((q) => q.sql.includes('shared.outbox'));
    expect(outboxInsert).toBeDefined();

    // The envelope JSON is params[3]
    const envelopeJson = outboxInsert!.params[3] as string;
    const envelope = JSON.parse(envelopeJson) as { schema_ref: string };
    expect(envelope.schema_ref).toBe('sim.case.lifecycle/CaseCreated/v1');
  });
});
