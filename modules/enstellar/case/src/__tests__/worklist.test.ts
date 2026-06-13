import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { getWorklist } from '../projections/worklist.js';
import type { DbClient } from '@sim/outbox-ts';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

const OPEN_CASES = [
  {
    case_id: 'case-uuid-001',
    state: 'clinical_review',
    urgency: 'expedited',
    lob: 'MA',
    member_ref: 'Patient/pat-001',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  },
  {
    case_id: 'case-uuid-002',
    state: 'completeness_check',
    urgency: 'standard',
    lob: 'MA',
    member_ref: 'Patient/pat-002',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

function makeClient(rows: Record<string, unknown>[]): DbClient {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

describe('Worklist Projection', () => {
  it('returns open cases not in terminal states', async () => {
    const client = makeClient(OPEN_CASES);

    const result = await withTenantContext(TEST_CONTEXT, () => getWorklist(client));

    expect(result).toHaveLength(2);
    // All returned cases should be non-terminal
    for (const entry of result) {
      expect(['determined', 'withdrawn', 'voided']).not.toContain(entry.state);
    }
  });

  it('maps all required fields correctly', async () => {
    const client = makeClient(OPEN_CASES);
    const result = await withTenantContext(TEST_CONTEXT, () => getWorklist(client));

    const first = result[0]!;
    expect(first.case_id).toBe('case-uuid-001');
    expect(first.state).toBe('clinical_review');
    expect(first.urgency).toBe('expedited');
    expect(first.lob).toBe('MA');
    expect(first.member_ref).toBe('Patient/pat-001');
  });

  it('returns empty array when no open cases exist', async () => {
    const client = makeClient([]);
    const result = await withTenantContext(TEST_CONTEXT, () => getWorklist(client));
    expect(result).toHaveLength(0);
  });

  it('uses correct SQL excluding terminal states', async () => {
    const client = makeClient([]);
    await withTenantContext(TEST_CONTEXT, () => getWorklist(client));

    const queryFn = client.query as ReturnType<typeof vi.fn>;
    const [[sql]] = queryFn.mock.calls as [[string]];
    expect(sql).toContain("NOT IN ('determined', 'withdrawn', 'voided')");
    expect(sql).toContain("ORDER BY (c.urgency = 'expedited') DESC, c.created_at ASC");
  });

  it('returns urgency field as standard or expedited', async () => {
    const client = makeClient(OPEN_CASES);
    const result = await withTenantContext(TEST_CONTEXT, () => getWorklist(client));

    for (const entry of result) {
      expect(['standard', 'expedited']).toContain(entry.urgency);
    }
  });

  it('expedited case appears before standard case in worklist order', async () => {
    // DB returns rows already ordered by the SQL (mock preserves order)
    const orderedRows = [
      {
        case_id: 'case-uuid-expedited',
        state: 'clinical_review',
        urgency: 'expedited',
        lob: 'MA',
        member_ref: 'Patient/pat-exp',
        created_at: '2025-01-02T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
      },
      {
        case_id: 'case-uuid-standard',
        state: 'completeness_check',
        urgency: 'standard',
        lob: 'MA',
        member_ref: 'Patient/pat-std',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];
    const client = makeClient(orderedRows);
    const result = await withTenantContext(TEST_CONTEXT, () => getWorklist(client));

    expect(result).toHaveLength(2);
    expect(result[0]!.urgency).toBe('expedited');
    expect(result[1]!.urgency).toBe('standard');
  });
});
