import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import { topicFor, type EventEnvelope, type TenantDb } from '@sim/outbox-ts';
import { renderTemplate } from '../templates/TemplateRenderer.js';

export interface IssueRfiParams {
  caseId: string;          // UUID string
  memberRef: string;
  memberName: string;
  rfiId: string;
  dueDate: string;         // ISO-8601
  channel: 'fax' | 'portal';
  templatePin: { canonical_url: string; version: string };
  requirementIds: string[];
}

export async function issueRfi(db: TenantDb, params: IssueRfiParams): Promise<string> {
  const tenantCtx = ctx();
  const commId = randomUUID();
  const eventId = randomUUID();

  const rendered = await renderTemplate(params.templatePin, {
    memberName: params.memberName,
    caseId: params.caseId,
    rfiDueDate: params.dueDate,
  });

  await db.transaction(async (client) => {
    // INSERT ens.communication
    await client.query(
      `INSERT INTO ens.communication
         (comm_id, case_id, tenant_id, kind, template_pin, recipient,
          channel, regulatory_content_profile, delivery_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        commId,
        params.caseId,
        tenantCtx.tenant_id,
        'rfi',
        JSON.stringify(params.templatePin),
        JSON.stringify({ fhir_ref: params.memberRef, name: params.memberName, rendered }),
        params.channel,
        'ma-cms-0057',
        'queued',
      ]
    );

    // Inline outbox INSERT (same transaction as comm INSERT)
    const envelope: EventEnvelope = {
      event_id: eventId,
      schema_ref: 'sim.case.lifecycle/RfiIssued/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: 'case_' + params.caseId,
      causation_id: null,
      actor: { type: 'service', id: 'enstellar-comms' },
      trace_ref: null,
      payload: { case_id: params.caseId, comm_id: commId, rfi_id: params.rfiId },
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

  return commId;
}
