import type { Pool } from 'pg';
import { ulid } from 'ulid';
import type { MeasureResult } from './evaluateMeasure.js';

export async function persistMeasureReport(
  pool: Pool,
  runId: string,
  tenantId: string,
  result: MeasureResult,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const reportId = ulid();

  await pool.query(
    `INSERT INTO qual.measure_report
       (report_id, tenant_id, run_id, member_id, measure_ref,
        period_start, period_end, numerator, denominator, exclusion,
        report, evidence_refs, trace_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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

  await pool.query(
    `INSERT INTO shared.outbox (tenant_id, topic, payload)
     VALUES ($1, $2, $3)`,
    [
      tenantId,
      'sim.qual.measure',
      JSON.stringify({
        event_type: 'MeasureReportCompleted',
        run_id: runId,
        member_id: result.member_id,
        measure_ref: result.measure_ref,
        numerator: result.numerator,
        denominator: result.denominator,
        exclusion: result.exclusion,
      }),
    ],
  );
}
