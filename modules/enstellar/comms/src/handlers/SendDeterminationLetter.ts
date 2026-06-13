import { randomUUID } from 'node:crypto';
import { ctx } from '@sim/tenant-context-ts';
import { topicFor, type EventEnvelope, type TenantDb } from '@sim/outbox-ts';
import { renderTemplate } from '../templates/TemplateRenderer.js';

export interface SendDeterminationLetterParams {
  caseId: string;
  memberRef: string;
  memberName: string;
  determinationId: string;
  outcome: string;
  decisionDate: string;
  channel: 'fax' | 'portal';
  templatePin: { canonical_url: string; version: string };
}

export async function sendDeterminationLetter(
  db: TenantDb,
  params: SendDeterminationLetterParams
): Promise<string> {
  const tenantCtx = ctx();
  const commId = randomUUID();
  const eventId = randomUUID();

  const rendered = await renderTemplate(params.templatePin, {
    memberName: params.memberName,
    caseId: params.caseId,
    determinationDate: params.decisionDate,
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
        'determination_letter',
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
      schema_ref: 'sim.case.lifecycle/DeterminationLetterSent/v1',
      occurred_at: new Date().toISOString(),
      tenant: { tenant_id: tenantCtx.tenant_id },
      correlation_id: 'case_' + params.caseId,
      causation_id: null,
      actor: { type: 'service', id: 'enstellar-comms' },
      trace_ref: null,
      payload: {
        case_id: params.caseId,
        comm_id: commId,
        determination_id: params.determinationId,
        outcome: params.outcome,
      },
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
