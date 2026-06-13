import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';
import { caseDetail } from '../resolvers/caseDetail.js';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: ['reviewer'],
  principal_type: 'human' as const,
};

const CASE_ID = '11111111-1111-1111-1111-111111111111';

const CASE_ROW = {
  case_id: CASE_ID,
  state: 'clinical_review',
  urgency: 'expedited',
  lob: 'MA',
  channel: 'PAS',
  member_ref: 'Patient/pat-001',
  coverage_ref: 'Coverage/cov-001',
  pins: [{ canonical_url: 'urn:sim:policy:knee-arthroscopy', version: '2.0' }],
  linked: { appeal_of: null, related_cases: ['22222222-2222-2222-2222-222222222222'] },
};

const SERVICE_LINE_ROWS = [
  { line_id: 'sl-001', code: '29881', qty: 1, status: 'pending' },
  { line_id: 'sl-002', code: '29882', qty: 2, status: 'pending' },
];

const DETERMINATION_ROWS = [
  {
    determination_id: 'det-001',
    outcome: 'approved',
    decided_by: JSON.stringify({ type: 'human', id: 'md-001' }),
    decided_at: '2024-01-05T10:00:00.000Z',
  },
];

const RFI_ROWS = [
  { rfi_id: 'rfi-001', status: 'open', due_by: '2024-01-10T00:00:00.000Z' },
];

function makeDb(caseRows = [CASE_ROW]): TenantDb {
  return {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('FROM ens.case')) {
            return { rows: caseRows };
          }
          if (sql.includes('FROM ens.service_line')) {
            return { rows: SERVICE_LINE_ROWS };
          }
          if (sql.includes('FROM ens.determination')) {
            return { rows: DETERMINATION_ROWS };
          }
          if (sql.includes('FROM ens.rfi')) {
            return { rows: RFI_ROWS };
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };
}

describe('caseDetail resolver', () => {
  it('returns null when case is not found', async () => {
    const db = makeDb([]);
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );
    expect(result).toBeNull();
  });

  it('populates all top-level case fields', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result).not.toBeNull();
    expect(result!.caseId).toBe(CASE_ID);
    expect(result!.state).toBe('clinical_review');
    expect(result!.urgency).toBe('expedited');
    expect(result!.lob).toBe('MA');
    expect(result!.channel).toBe('PAS');
    expect(result!.memberRef).toBe('Patient/pat-001');
    expect(result!.coverageRef).toBe('Coverage/cov-001');
  });

  it('populates serviceLines from ens.service_line', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.serviceLines).toHaveLength(2);
    expect(result!.serviceLines[0]!.lineId).toBe('sl-001');
    expect(result!.serviceLines[0]!.code).toBe('29881');
    expect(result!.serviceLines[0]!.qty).toBe(1);
    expect(result!.serviceLines[0]!.status).toBe('pending');
    expect(result!.serviceLines[1]!.lineId).toBe('sl-002');
  });

  it('populates determinations from ens.determination', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.determinations).toHaveLength(1);
    expect(result!.determinations[0]!.determinationId).toBe('det-001');
    expect(result!.determinations[0]!.outcome).toBe('approved');
    expect(result!.determinations[0]!.decidedAt).toBe('2024-01-05T10:00:00.000Z');
  });

  it('populates rfis from ens.rfi', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.rfis).toHaveLength(1);
    expect(result!.rfis[0]!.rfiId).toBe('rfi-001');
    expect(result!.rfis[0]!.status).toBe('open');
    expect(result!.rfis[0]!.dueBy).toBe('2024-01-10T00:00:00.000Z');
  });

  it('parses pins JSONB into ArtifactPin array', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.pins).toHaveLength(1);
    expect(result!.pins[0]!.canonicalUrl).toBe('urn:sim:policy:knee-arthroscopy');
    expect(result!.pins[0]!.version).toBe('2.0');
  });

  it('parses linked JSONB into LinkedCases', async () => {
    const db = makeDb();
    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.linked.appealOf).toBeNull();
    expect(result!.linked.relatedCases).toEqual([
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('handles empty serviceLines, determinations, and rfis gracefully', async () => {
    const db: TenantDb = {
      transaction: vi.fn(async (fn) => {
        const client = {
          query: vi.fn(async (sql: string) => {
            if (sql.includes('FROM ens.case')) return { rows: [CASE_ROW] };
            return { rows: [] }; // All related tables empty
          }),
        };
        return fn(client);
      }),
    };

    const result = await withTenantContext(TEST_CONTEXT, () =>
      caseDetail(db, CASE_ID)
    );

    expect(result!.serviceLines).toHaveLength(0);
    expect(result!.determinations).toHaveLength(0);
    expect(result!.rfis).toHaveLength(0);
  });

  it('ctx() is called — throws without tenant context', async () => {
    const db = makeDb();
    await expect(caseDetail(db, CASE_ID)).rejects.toThrow('No tenant context');
  });
});
