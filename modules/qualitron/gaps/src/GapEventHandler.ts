import type { Pool } from 'pg';
import { ulid } from 'ulid';
import { detectGap } from './GapDetector.js';
import { createOutreachTask } from './OutreachTaskCreator.js';

export interface MeasureReportCompletedPayload {
  event_type: 'MeasureReportCompleted';
  run_id: string;
  member_id: string;
  measure_ref: string;
  numerator: boolean;
  denominator: boolean;
  exclusion: boolean;
}

export async function handleMeasureReportCompleted(
  payload: MeasureReportCompletedPayload,
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  pool: Pool,
  taskServiceUrl: string,
): Promise<void> {
  const decision = detectGap({
    run_id: payload.run_id,
    member_id: payload.member_id,
    measure_ref: payload.measure_ref,
    period_start: periodStart,
    period_end: periodEnd,
    numerator: payload.numerator,
    denominator: payload.denominator,
    exclusion: payload.exclusion,
  });

  if (decision.has_gap) {
    const gapId = ulid();
    const { rows: existingGap } = await pool.query<{ gap_id: string }>(
      `SELECT gap_id FROM qual.gap
       WHERE tenant_id = $1 AND member_id = $2 AND measure_ref = $3
         AND period_start = $4 AND period_end = $5 AND status = 'open'
       LIMIT 1`,
      [tenantId, payload.member_id, payload.measure_ref, periodStart, periodEnd],
    );

    const activeGapId = existingGap[0]?.gap_id ?? gapId;

    if (!existingGap[0]) {
      await pool.query(
        `INSERT INTO qual.gap (gap_id, tenant_id, member_id, measure_ref, period_start, period_end, gap_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [gapId, tenantId, payload.member_id, payload.measure_ref, periodStart, periodEnd, decision.gap_type],
      );
    }

    if (decision.should_create_outreach) {
      const taskResult = await createOutreachTask(
        {
          tenant_id: tenantId,
          gap_id: activeGapId,
          member_id: payload.member_id,
          measure_ref: payload.measure_ref,
          period_start: periodStart,
          period_end: periodEnd,
        },
        taskServiceUrl,
      );
      if (taskResult) {
        await pool.query(
          `INSERT INTO qual.outreach_task_ref (id, tenant_id, gap_id, task_id)
           VALUES ($1, $2, $3, $4)`,
          [ulid(), tenantId, activeGapId, taskResult.task_id],
        );
      }
    }
  } else if (payload.numerator) {
    // Numerator met — close any open gaps for this member+measure+period
    const { rows: closedGaps } = await pool.query<{
      gap_id: string;
      member_id: string;
      measure_ref: string;
    }>(
      `UPDATE qual.gap
       SET status = 'closed', closed_at = NOW(), closure_reason = 'numerator_met'
       WHERE tenant_id = $1 AND member_id = $2 AND measure_ref = $3
         AND period_start = $4 AND period_end = $5 AND status = 'open'
       RETURNING gap_id, member_id, measure_ref`,
      [tenantId, payload.member_id, payload.measure_ref, periodStart, periodEnd],
    );
    for (const gap of closedGaps) {
      const eventId = 'evt_' + ulid();
      const closedAt = new Date().toISOString();
      await pool.query(
        `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
         VALUES ($1, 'qual.gap.closed', $2, $3::jsonb, $4)`,
        [
          eventId,
          gap.gap_id,
          JSON.stringify({
            event_id: eventId,
            schema_ref: 'sim.qual.gap/QualGapClosed/v1',
            occurred_at: closedAt,
            tenant: { tenant_id: tenantId },
            correlation_id: gap.gap_id,
            payload: {
              event_type: 'QualGapClosed',
              gap_id: gap.gap_id,
              member_id: gap.member_id,
              measure_ref: gap.measure_ref,
              closed_at: closedAt,
            },
          }),
          tenantId,
        ],
      );
    }
  }
}
