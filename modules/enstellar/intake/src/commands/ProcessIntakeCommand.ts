import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import type { TenantDb, EventEnvelope } from '@sim/outbox-ts';
import { topicFor } from '@sim/outbox-ts';
import { MemberResolver } from '../member/MemberResolver.js';
import type { MemberResolution } from '../member/MemberResolver.js';
import { CaseDeduplicate } from '../dedup/CaseDeduplicate.js';
import { FabricSeeder } from '../fabric/FabricSeeder.js';
import { createIntakeExceptionTask } from '../tasks/IntakeExceptionTask.js';

/** Member resolution score below this threshold halts processing and creates an exception task. */
const MEMBER_RESOLUTION_THRESHOLD = 0.85;

export interface IntakeCommand {
  channel: 'PAS' | 'X12_278' | 'PORTAL' | 'FAX_OCR';
  caseRef: string | null;
  rawPayloadRef: string;
  receivedAt: string; // ISO-8601
  memberRef: string;
  coverageRef: string;
  providers: { requestingNpi?: string; servicingNpi?: string };
  serviceLines: Array<{ code: string; system?: string; qty?: number }>;
  urgency: 'standard' | 'expedited';
  externalIds: Array<{ system: string; value: string }>;
}

export interface IntakeResult {
  caseId: string;
  status: 'created' | 'linked';
}

export class ProcessIntakeCommand {
  private readonly resolver: { resolve: (memberRef: string) => MemberResolution };
  private readonly dedup: CaseDeduplicate;
  private readonly seeder: FabricSeeder;

  constructor(
    private readonly db: TenantDb,
    resolverOverride?: { resolve: (memberRef: string) => MemberResolution }
  ) {
    this.resolver = resolverOverride ?? new MemberResolver();
    this.dedup = new CaseDeduplicate(db);
    this.seeder = new FabricSeeder(db);
  }

  async execute(command: IntakeCommand): Promise<IntakeResult> {
    const tenantCtx = ctx();

    // 1. Member resolution (Phase 1: exact match only, score=1.0)
    const resolution = this.resolver.resolve(command.memberRef);

    // Guard: member match below threshold → create exception task and halt
    if (resolution.score < MEMBER_RESOLUTION_THRESHOLD) {
      await createIntakeExceptionTask(this.db, null, {
        memberRef: command.memberRef,
        reason: 'member_resolution_below_threshold',
        memberResolutionScore: resolution.score,
        rawPayloadRef: command.rawPayloadRef,
      });
      throw new Error(`Member resolution below threshold: score=${resolution.score}`);
    }

    // 2. Case deduplication (match on member + provider + code + date ±3 days)
    const firstLine = command.serviceLines[0];
    const firstCode = firstLine?.code ?? '';
    const receivedAt = new Date(command.receivedAt);

    const existingCaseId = await this.dedup.findDuplicate({
      memberRef: resolution.memberRef,
      code: firstCode,
      createdAt: receivedAt,
      providerNpi: command.providers.requestingNpi,
    });

    if (existingCaseId !== null) {
      // Link to existing case — do NOT emit CaseCreated
      return { caseId: existingCaseId, status: 'linked' };
    }

    // 3. Seed fabric resources (Patient + Coverage + Practitioner)
    await this.seeder.seed({
      memberRef: command.memberRef,
      coverageRef: command.coverageRef,
      rawPayloadRef: command.rawPayloadRef,
      providerNpi: command.providers.requestingNpi,
    });

    // 4. Create case + service lines in ONE atomic transaction
    // ens.case.case_id is UUID (Phase 0 schema), stored as UUID
    const caseId = randomUUID();
    const eventId = randomUUID();
    const lobValue = tenantCtx.scopes.lob[0] ?? 'MA';

    await this.db.transaction(async (client) => {
      // INSERT ens.case — channel is a top-level column (NOT NULL in Phase 0 schema)
      await client.query(
        `INSERT INTO ens.case
           (case_id, tenant_id, lob, state, urgency, channel, member_ref, coverage_ref, origin, providers)
         VALUES ($1, $2, $3, 'RECEIVED', $4, $5, $6, $7, $8, $9)`,
        [
          caseId,
          tenantCtx.tenant_id,
          lobValue,
          command.urgency,
          command.channel,
          resolution.memberRef,
          command.coverageRef,
          JSON.stringify({
            rawPayloadRef: command.rawPayloadRef,
            receivedAt: command.receivedAt,
            externalIds: command.externalIds,
          }),
          JSON.stringify(command.providers),
        ]
      );

      // INSERT ens.service_line rows
      for (const line of command.serviceLines) {
        const lineId = randomUUID();
        await client.query(
          `INSERT INTO ens.service_line
             (line_id, case_id, tenant_id, code, qty, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            lineId,
            caseId,
            tenantCtx.tenant_id,
            JSON.stringify({ code: line.code, system: line.system ?? 'unknown' }),
            line.qty ?? 1,
            'requested',
          ]
        );
      }

      // 5. Emit CaseCreated via outbox — inside the same transaction for atomicity
      //    A crash between the case INSERT and outbox INSERT would cause CaseCreated to be lost.
      const envelope: EventEnvelope = {
        event_id: eventId,
        schema_ref: 'sim.case.lifecycle/CaseCreated/v1',
        occurred_at: new Date().toISOString(),
        tenant: { tenant_id: tenantCtx.tenant_id },
        correlation_id: 'case_' + caseId,
        causation_id: null,
        actor: { type: 'service', id: 'enstellar-intake' },
        trace_ref: null,
        payload: { case_id: caseId, channel: command.channel, urgency: command.urgency },
      };
      await client.query(
        `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          topicFor(envelope.schema_ref),
          envelope.correlation_id,
          JSON.stringify(envelope),
          tenantCtx.tenant_id,
        ]
      );
    });

    return { caseId, status: 'created' };
  }
}
