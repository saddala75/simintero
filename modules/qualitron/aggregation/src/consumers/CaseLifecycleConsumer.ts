import type { Pool } from 'pg';

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

  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     VALUES ($1, $2, $3)`,
    [
      event.tenant_id,
      'sim.qual.eligibility',
      JSON.stringify({
        event_type: 'MemberEligibilityCheck',
        source_event_id: event.event_id,
        member_id: event.member_id,
        case_ref: event.case_ref,
      }),
    ],
  );
}
