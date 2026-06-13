import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { sendDeterminationLetter } from '../handlers/SendDeterminationLetter.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['service'],
  principal_type: 'service' as const,
};

const SAMPLE_DET_PARAMS = {
  caseId: '550e8400-e29b-41d4-a716-446655440001',
  memberRef: 'Patient/member-002',
  memberName: 'Jane Smith',
  determinationId: 'det-001',
  outcome: 'approved',
  decisionDate: '2026-03-15',
  channel: 'portal' as const,
  templatePin: { canonical_url: 'determination-letter', version: '1.0' },
};

function makeDb(capturedSqls: string[] = [], capturedParams: unknown[][] = []): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          capturedSqls.push(sql);
          capturedParams.push(params ?? []);
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('SendDeterminationLetter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch to avoid VKAS network calls
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
  });

  it('inserts ens.communication row and outbox entry in same transaction', async () => {
    const captured: string[] = [];
    const db = makeDb(captured);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    expect(captured.some(sql => sql.includes('ens.communication'))).toBe(true);
    expect(captured.some(sql => sql.includes('shared.outbox'))).toBe(true);
  });

  it('both inserts happen inside a single db.transaction() call', async () => {
    const captured: string[] = [];
    const db = makeDb(captured);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const txFn = db.transaction as ReturnType<typeof vi.fn>;
    expect(txFn).toHaveBeenCalledTimes(1);
    expect(captured.length).toBe(2);
  });

  it('outbox event has schema_ref sim.case.lifecycle/DeterminationLetterSent/v1', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const outboxIndex = capturedSqls.findIndex(sql => sql.includes('shared.outbox'));
    expect(outboxIndex).toBeGreaterThanOrEqual(0);
    const envelopeJson = capturedParams[outboxIndex]?.[3] as string;
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.schema_ref).toBe('sim.case.lifecycle/DeterminationLetterSent/v1');
  });

  it('stores correct kind=determination_letter in ens.communication', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const commIndex = capturedSqls.findIndex(sql => sql.includes('ens.communication'));
    expect(commIndex).toBeGreaterThanOrEqual(0);
    expect(capturedParams[commIndex]).toContain('determination_letter');
  });

  it('sets tenant_id from tenant context', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const commIndex = capturedSqls.findIndex(sql => sql.includes('ens.communication'));
    expect(capturedParams[commIndex]).toContain('t_test');
  });

  it('returns a comm_id string', async () => {
    const db = makeDb();
    const commId = await withTenantContext(TEST_CONTEXT, () =>
      sendDeterminationLetter(db, SAMPLE_DET_PARAMS)
    );
    expect(typeof commId).toBe('string');
    expect(commId.length).toBeGreaterThan(0);
  });

  it('outbox correlation_id matches case_id', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const outboxIndex = capturedSqls.findIndex(sql => sql.includes('shared.outbox'));
    const envelopeJson = capturedParams[outboxIndex]?.[3] as string;
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.correlation_id).toBe('case_' + SAMPLE_DET_PARAMS.caseId);
  });

  it('outbox payload includes outcome and determination_id', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => sendDeterminationLetter(db, SAMPLE_DET_PARAMS));
    const outboxIndex = capturedSqls.findIndex(sql => sql.includes('shared.outbox'));
    const envelopeJson = capturedParams[outboxIndex]?.[3] as string;
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.payload.outcome).toBe('approved');
    expect(envelope.payload.determination_id).toBe('det-001');
  });
});
