/**
 * emitTransitionEvent — writes a CaseStateChanged event to the outbox
 * by calling the case-service HTTP endpoint.
 *
 * Activities run outside the Temporal sandbox so direct network I/O is allowed.
 * All non-2xx responses (including 404/501) throw so Temporal retries.
 */
import { type EventEnvelope } from '@sim/outbox-ts';
import { randomUUID } from 'node:crypto';

const CASE_SERVICE_URL = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:3002';
const CASE_SERVICE_TIMEOUT_MS = Number(process.env['CASE_SERVICE_TIMEOUT_MS'] ?? 5000);

export async function emitTransitionEvent(params: {
  caseId: string;
  tenantId: string;
  fromState: string;
  toState: string;
  trigger: string;
  humanSignoffRecorded?: boolean;
}): Promise<void> {
  const { caseId, tenantId, fromState, toState, trigger, humanSignoffRecorded } = params;
  const eventId = randomUUID();
  const envelope: EventEnvelope = {
    event_id: eventId,
    schema_ref: 'sim.case.lifecycle/CaseStateChanged/v1',
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    correlation_id: 'case_' + caseId,
    causation_id: null,
    actor: { type: 'service', id: 'enstellar-workflow' },
    trace_ref: null,
    payload: { case_id: caseId, from: fromState, to: toState, trigger, human_signoff_recorded: humanSignoffRecorded ?? false },
  };

  let resp: Response;
  try {
    resp = await fetch(`${CASE_SERVICE_URL}/internal/transitions/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-tenant-id': tenantId },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(CASE_SERVICE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `emitTransitionEvent unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!resp.ok) {
    throw new Error(
      `case-service returned ${resp.status} for ${caseId} ${fromState}→${toState}`
    );
  }
}
