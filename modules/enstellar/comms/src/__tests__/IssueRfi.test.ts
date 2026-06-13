import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { issueRfi } from '../handlers/IssueRfi.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['service'],
  principal_type: 'service' as const,
};

const SAMPLE_RFI_PARAMS = {
  caseId: '550e8400-e29b-41d4-a716-446655440000',
  memberRef: 'Patient/member-001',
  memberName: 'John Doe',
  rfiId: 'rfi-001',
  dueDate: '2026-02-28',
  channel: 'fax' as const,
  templatePin: { canonical_url: 'rfi-template', version: '1.0' },
  requirementIds: ['req-001', 'req-002'],
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

describe('IssueRfi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch to avoid VKAS network calls
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 501 }));
  });

  it('inserts ens.communication row and outbox entry in same transaction', async () => {
    const captured: string[] = [];
    const db = makeDb(captured);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    expect(captured.some(sql => sql.includes('ens.communication'))).toBe(true);
    expect(captured.some(sql => sql.includes('shared.outbox'))).toBe(true);
  });

  it('both inserts happen inside a single db.transaction() call', async () => {
    const captured: string[] = [];
    const db = makeDb(captured);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    const txFn = db.transaction as ReturnType<typeof vi.fn>;
    // Only one transaction should be opened
    expect(txFn).toHaveBeenCalledTimes(1);
    // Both ens.communication and shared.outbox inserts are inside it
    expect(captured.length).toBe(2);
  });

  it('outbox event has schema_ref sim.case.lifecycle/RfiIssued/v1', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    const outboxIndex = capturedSqls.findIndex(sql => sql.includes('shared.outbox'));
    expect(outboxIndex).toBeGreaterThanOrEqual(0);
    // The 4th param (index 3) is the envelope JSON
    const envelopeJson = capturedParams[outboxIndex]?.[3] as string;
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.schema_ref).toBe('sim.case.lifecycle/RfiIssued/v1');
  });

  it('stores correct kind=rfi in ens.communication', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    const commIndex = capturedSqls.findIndex(sql => sql.includes('ens.communication'));
    expect(commIndex).toBeGreaterThanOrEqual(0);
    // 'rfi' is the 4th param (index 3) in the INSERT
    expect(capturedParams[commIndex]).toContain('rfi');
  });

  it('sets tenant_id from tenant context', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    const commIndex = capturedSqls.findIndex(sql => sql.includes('ens.communication'));
    expect(capturedParams[commIndex]).toContain('t_test');
  });

  it('returns a comm_id string', async () => {
    const db = makeDb();
    const commId = await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    expect(typeof commId).toBe('string');
    expect(commId.length).toBeGreaterThan(0);
  });

  it('outbox correlation_id matches case_id', async () => {
    const capturedSqls: string[] = [];
    const capturedParams: unknown[][] = [];
    const db = makeDb(capturedSqls, capturedParams);
    await withTenantContext(TEST_CONTEXT, () => issueRfi(db, SAMPLE_RFI_PARAMS));
    const outboxIndex = capturedSqls.findIndex(sql => sql.includes('shared.outbox'));
    const envelopeJson = capturedParams[outboxIndex]?.[3] as string;
    const envelope = JSON.parse(envelopeJson);
    expect(envelope.correlation_id).toBe('case_' + SAMPLE_RFI_PARAMS.caseId);
  });
});
