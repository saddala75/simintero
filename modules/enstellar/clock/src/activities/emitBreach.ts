/**
 * emitBreach — POSTs a ClockBreached event when a regulatory clock deadline is exceeded.
 *
 * 501/404 → stub tolerance (Phase 1).
 * 5xx or other errors → throw so Temporal retries.
 */

import { randomUUID } from 'node:crypto';

const CASE_SERVICE_URL = process.env['CASE_SERVICE_URL'] ?? 'http://localhost:3001';

export interface EmitBreachParams {
  caseId: string;
  tenantId: string;
  clockType: string;
}

export async function emitBreach(params: EmitBreachParams): Promise<void> {
  const { caseId, tenantId, clockType } = params;

  const envelope = {
    event_id: randomUUID(),
    schema_ref: 'sim.clock.ClockBreached/v1',
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    correlation_id: 'case_' + caseId,
    causation_id: null,
    actor: { type: 'service', id: 'enstellar-clock' },
    trace_ref: null,
    payload: { case_id: caseId, clock_type: clockType },
  };

  try {
    const resp = await fetch(`${CASE_SERVICE_URL}/internal/transitions/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(1000),
    });

    if (resp.status === 501 || resp.status === 404) {
      // Phase 1 stub: case-service not yet wired up
      console.warn(`emitBreach: case-service stub (${resp.status}); case=${caseId} clock=${clockType}`);
      return;
    }

    if (!resp.ok) {
      throw new Error(`emitBreach: case-service returned ${resp.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('emitBreach:')) throw err;
    throw new Error(`emitBreach unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
