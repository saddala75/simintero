import type { Pool } from 'pg';
import { appendEvent } from '@sim/outbox-ts/append';
import { withTenant } from '../db/withTenant.js';

export interface CaseLifecycleEvent {
  event_id: string;
  event_type: string;
  tenant_id: string;
  case_ref: string;
  member_id: string;
}

export async function handleCaseLifecycleEvent(
  event: CaseLifecycleEvent,
  pool: Pool,
): Promise<void> {
  if (event.event_type !== 'CaseDetermined') return;

  await withTenant(pool, event.tenant_id, (client) =>
    appendEvent(client, {
      schemaRef: 'sim.qual.eligibility/MemberEligibilityCheck/v1',
      tenantId: event.tenant_id,
      topic: 'sim.qual.eligibility',
      correlationId: event.member_id,
      payload: {
        event_type: 'MemberEligibilityCheck',
        source_event_id: event.event_id,
        member_id: event.member_id,
        case_ref: event.case_ref,
      },
    }),
  );
}
