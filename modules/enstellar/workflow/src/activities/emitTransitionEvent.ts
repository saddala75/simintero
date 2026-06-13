/**
 * emitTransitionEvent — writes a CaseStateChanged event to the outbox
 * by calling the case-service HTTP endpoint.
 *
 * Activities run outside the Temporal sandbox so direct network I/O is allowed.
 * Phase 1 acceptable no-ops: 501 and 404 (service not yet implemented).
 * All other failures (5xx, network errors, timeouts) throw so Temporal retries.
 */
import { type EventEnvelope } from '@sim/outbox-ts';
import { randomUUID } from 'node:crypto';

const CASE_SERVICE_URL = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:3002';

export async function emitTransitionEvent(params: {
  caseId: string;
  tenantId: string;
  fromState: string;
  toState: string;
  trigger: string;
}): Promise<void> {
  const { caseId, tenantId, fromState, toState, trigger } = params;
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
    payload: { case_id: caseId, from: fromState, to: toState, trigger },
  };

  try {
    const resp = await fetch(`${CASE_SERVICE_URL}/internal/transitions/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(2000),
    });

    // Phase 1 stubs: 501 and 404 mean service not yet implemented — acceptable no-op
    if (resp.status === 501 || resp.status === 404) {
      return;
    }

    if (!resp.ok) {
      // 5xx and other errors should throw so Temporal retries
      throw new Error(`case-service returned ${resp.status} for ${caseId} ${fromState}→${toState}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('case-service returned')) {
      throw err; // Re-throw 5xx errors for Temporal retry
    }
    // Network errors, timeouts — throw for Temporal retry
    throw new Error(`emitTransitionEvent unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
