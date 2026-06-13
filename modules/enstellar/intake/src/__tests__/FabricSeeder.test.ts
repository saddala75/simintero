import { describe, it, expect, vi } from 'vitest';
import { withTenantContext } from '@sim/tenant-context-ts';
import { FabricSeeder } from '../fabric/FabricSeeder.js';
import type { TenantDb } from '@sim/outbox-ts';

const TEST_CONTEXT = {
  tenant_id: 't_test',
  cell_id: 'cell-pooled-us1',
  tier: 'pooled' as const,
  scopes: { lob: ['MA' as const], region: ['TX'], modules: ['ENS'] },
  roles: [],
  principal_type: 'service' as const,
};

function makeCapturingDb() {
  const insertedRows: Array<{ resource_type: string; provenance_ref: string }> = [];

  const db: TenantDb = {
    transaction: vi.fn(async (fn) => {
      const client = {
        query: vi.fn(async (_sql: string, params?: unknown[]) => {
          if (params && typeof params[1] === 'string') {
            // New FabricSeeder INSERT params (8 total, id via gen_random_uuid() in SQL):
            // $1=tenant_id[0], $2=resource_type[1], $3=fhir_id[2], $4=profile[3],
            // $5=content[4], $6=member_ref[5], $7=source[6], $8=provenance_ref[7]
            insertedRows.push({
              resource_type: params[1] as string,
              provenance_ref: params[7] as string,
            });
          }
          return { rows: [] };
        }),
      };
      return fn(client);
    }),
  };

  return { db, insertedRows };
}

describe('FabricSeeder', () => {
  const command = {
    memberRef: 'Patient/pat-001',
    coverageRef: 'Coverage/cov-001',
    rawPayloadRef: 'payload-ref-xyz',
  };

  it('insertsPatientRow — seeds a fabric.resource row with resource_type=Patient', async () => {
    const { db, insertedRows } = makeCapturingDb();
    const seeder = new FabricSeeder(db);

    await withTenantContext(TEST_CONTEXT, () => seeder.seed(command));

    const patientRow = insertedRows.find((r) => r.resource_type === 'Patient');
    expect(patientRow).toBeDefined();
  });

  it('insertsCoverageRow — seeds a fabric.resource row with resource_type=Coverage', async () => {
    const { db, insertedRows } = makeCapturingDb();
    const seeder = new FabricSeeder(db);

    await withTenantContext(TEST_CONTEXT, () => seeder.seed(command));

    const coverageRow = insertedRows.find((r) => r.resource_type === 'Coverage');
    expect(coverageRow).toBeDefined();
  });

  it('insertsPractitionerRow — seeds a fabric.resource row with resource_type=Practitioner when providerNpi provided', async () => {
    const { db, insertedRows } = makeCapturingDb();
    const seeder = new FabricSeeder(db);

    await withTenantContext(TEST_CONTEXT, () =>
      seeder.seed({ ...command, providerNpi: 'NPI12345' })
    );

    const practitionerRow = insertedRows.find((r) => r.resource_type === 'Practitioner');
    expect(practitionerRow).toBeDefined();
  });

  it('requiresProvenanceRef — every inserted row has a non-null provenance_ref', async () => {
    const { db, insertedRows } = makeCapturingDb();
    const seeder = new FabricSeeder(db);

    await withTenantContext(TEST_CONTEXT, () => seeder.seed(command));

    expect(insertedRows.length).toBeGreaterThan(0);
    for (const row of insertedRows) {
      expect(row.provenance_ref).toBeTruthy();
      expect(row.provenance_ref).toBe('intake:payload-ref-xyz');
    }
  });
});
