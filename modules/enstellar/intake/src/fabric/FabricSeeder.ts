import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb } from '@sim/outbox-ts';

export interface IntakeCommandForFabric {
  memberRef: string;
  coverageRef: string;
  rawPayloadRef: string;
  providerNpi?: string;
}

/**
 * Seeds fabric.resource rows for Patient, Coverage, and (optionally) Practitioner
 * resources extracted from an IntakeCommand.
 *
 * Uses Phase 0 fabric.resource schema:
 *   id UUID (gen_random_uuid()), fhir_id TEXT, UNIQUE (tenant_id, resource_type, fhir_id)
 * V005 adds: member_ref TEXT, classification TEXT DEFAULT 'standard'
 */
export class FabricSeeder {
  constructor(private readonly db: TenantDb) {}

  async seed(command: IntakeCommandForFabric): Promise<void> {
    const tenantCtx = ctx();
    const provenanceRef = `intake:${command.rawPayloadRef}`;

    await this.db.transaction(async (client) => {
      // Insert Patient resource
      await client.query(
        `INSERT INTO fabric.resource
           (id, tenant_id, resource_type, fhir_id, version, profile, content,
            member_ref, source, provenance_ref, last_updated)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, $4, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING`,
        [
          tenantCtx.tenant_id,
          'Patient',
          command.memberRef,
          'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
          JSON.stringify({ resourceType: 'Patient', id: command.memberRef }),
          command.memberRef,
          'exchange',
          provenanceRef,
        ]
      );

      // Insert Coverage resource
      await client.query(
        `INSERT INTO fabric.resource
           (id, tenant_id, resource_type, fhir_id, version, profile, content,
            member_ref, source, provenance_ref, last_updated)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, $4, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING`,
        [
          tenantCtx.tenant_id,
          'Coverage',
          command.coverageRef,
          'http://hl7.org/fhir/us/core/StructureDefinition/us-core-coverage',
          JSON.stringify({ resourceType: 'Coverage', id: command.coverageRef }),
          command.memberRef,
          'exchange',
          provenanceRef,
        ]
      );

      // Insert Practitioner resource (only when providerNpi is provided)
      if (command.providerNpi) {
        await client.query(
          `INSERT INTO fabric.resource
             (id, tenant_id, resource_type, fhir_id, version, profile, content,
              member_ref, source, provenance_ref, last_updated)
           VALUES (gen_random_uuid(), $1, $2, $3, 1, $4, $5, $6, $7, $8, now())
           ON CONFLICT (tenant_id, resource_type, fhir_id) DO NOTHING`,
          [
            tenantCtx.tenant_id,
            'Practitioner',
            command.providerNpi,
            'http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner',
            JSON.stringify({ resourceType: 'Practitioner', id: command.providerNpi }),
            command.memberRef,
            'exchange',
            provenanceRef,
          ]
        );
      }
    });
  }
}
