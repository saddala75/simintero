import { evaluateMeasure } from '../activities/evaluateMeasure.js';
import { persistMeasureReport } from '../activities/persistMeasureReport.js';
import { fetchEligibleMembers } from '../activities/fetchEligibleMembers.js';
import type { Pool } from 'pg';

export interface RunMeasureInput {
  run_id: string;
  tenant_id: string;
  measure_ref: string;
  measure_version: string;
  period_start: string;
  period_end: string;
}

export interface RunMeasureResult {
  run_id: string;
  total: number;
  failed: number;
}

export async function qualitronRunMeasure(
  input: RunMeasureInput,
  pool: Pool,
  digicoreUrl: string,
): Promise<RunMeasureResult> {
  await pool.query(
    `UPDATE qual.measure_run SET status = 'running', started_at = NOW() WHERE run_id = $1`,
    [input.run_id],
  );

  const memberIds = await fetchEligibleMembers(pool, input.period_start, input.period_end);

  let failed = 0;

  for (const memberId of memberIds) {
    try {
      const result = await evaluateMeasure(
        memberId,
        input.measure_ref,
        input.measure_version,
        input.period_start,
        input.period_end,
        digicoreUrl,
      );
      if (result) {
        await persistMeasureReport(pool, input.run_id, input.tenant_id, result, input.period_start, input.period_end);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  await pool.query(
    `UPDATE qual.measure_run SET status = 'complete', completed_at = NOW() WHERE run_id = $1`,
    [input.run_id],
  );

  return { run_id: input.run_id, total: memberIds.length, failed };
}
