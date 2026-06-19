import type { PoolClient } from 'pg';
import { ulid } from 'ulid';
import type { MeasureResult } from './evaluateMeasure.js';

export async function persistMeasureReport(
  client: PoolClient,
  runId: string,
  tenantId: string,
  result: MeasureResult,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const reportId = ulid();

  await client.query(
    `INSERT INTO qual.measure_report
       (report_id, tenant_id, run_id, member_id, measure_ref,
        period_start, period_end, numerator, denominator, exclusion,
        report, evidence_refs, trace_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)`,
    [
      reportId,
      tenantId,
      runId,
      result.member_id,
      result.measure_ref,
      periodStart,
      periodEnd,
      result.numerator,
      result.denominator,
      result.exclusion,
      JSON.stringify(result),
      JSON.stringify(result.evidence_refs),
      result.trace_ref,
    ],
  );

  const eventId = 'evt_' + ulid();
  const envelope = {
    event_id: eventId,
    schema_ref: 'sim.qual.measure/MeasureReportCompleted/v1',
    occurred_at: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    correlation_id: runId,
    payload: {
      event_type: 'MeasureReportCompleted',
      run_id: runId,
      member_id: result.member_id,
      measure_ref: result.measure_ref,
      numerator: result.numerator,
      denominator: result.denominator,
      exclusion: result.exclusion,
    },
  };

  await client.query(
    `INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [eventId, 'sim.qual.measure', result.member_id, JSON.stringify(envelope), tenantId],
  );
}
