import { evaluateMeasure, type MeasureSpec, type MeasureResult } from '../activities/evaluateMeasure.js';
import { evaluateWithDigicore } from '../activities/evaluateWithDigicore.js';
import {
  persistMeasureReport,
  persistSummaryMeasureReport,
} from '../activities/persistMeasureReport.js';
import { fetchEligibleMembers } from '../activities/fetchEligibleMembers.js';
import { withTenant } from '../db/withTenant.js';
import { handleMeasureReportCompleted } from '@sim/qualitron-gaps';
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

/**
 * Execute a measure run, self-contained under a single tenant transaction:
 * load the measure spec, evaluate each eligible member over the fabric, persist
 * the report (+ outbox), and detect gaps in-process. All writes share the run's
 * client so they commit/rollback together and run under the same RLS tenant.
 *
 * When `digicore_library_ref` is set on the measure definition, the Digicore
 * CQL path is used: one batch HTTP call for all members. Otherwise the legacy
 * SQL fabric path (evaluateMeasure per member) is used unchanged.
 */
export async function qualitronRunMeasure(
  input: RunMeasureInput,
  pool: Pool,
  taskServiceUrl: string,
): Promise<RunMeasureResult> {
  return withTenant(pool, input.tenant_id, async (client) => {
    await client.query(
      `UPDATE qual.measure_run SET status = 'running', started_at = NOW() WHERE run_id = $1`,
      [input.run_id],
    );

    const { rows: defRows } = await client.query<{
      spec: MeasureSpec;
      digicore_library_ref: string | null;
    }>(
      `SELECT spec, digicore_library_ref FROM qual.measure_definition WHERE measure_ref = $1 AND version = $2`,
      [input.measure_ref, input.measure_version],
    );
    if (!defRows[0]) {
      await client.query(
        `UPDATE qual.measure_run SET status = 'failed', completed_at = NOW() WHERE run_id = $1`,
        [input.run_id],
      );
      return { run_id: input.run_id, total: 0, failed: 0 };
    }

    const { spec, digicore_library_ref } = defRows[0];
    const members = await fetchEligibleMembers(client);
    let failed = 0;

    if (digicore_library_ref) {
      // Digicore CQL path: batch evaluate all members in one HTTP call
      const digiResults = await evaluateWithDigicore({
        tenantId: input.tenant_id,
        libraryRef: digicore_library_ref,
        memberRefs: members,
        periodStart: input.period_start,
        periodEnd: input.period_end,
      });

      const measureUrl = `http://sim.internal/Measure/${input.measure_ref}`;
      const allResults: MeasureResult[] = [];

      for (const dr of digiResults) {
        try {
          const result: MeasureResult = {
            member_id: dr.memberRef,
            measure_ref: input.measure_ref,
            numerator: dr.numerator,
            denominator: dr.denominator,
            exclusion: dr.exclusion,
            evidence_refs: [],
            trace_ref: dr.traceRef,
          };
          await persistMeasureReport(
            client,
            input.run_id,
            input.tenant_id,
            result,
            input.period_start,
            input.period_end,
            measureUrl,
          );
          allResults.push(result);
          await handleMeasureReportCompleted(
            {
              event_type: 'MeasureReportCompleted',
              run_id: input.run_id,
              member_id: result.member_id,
              measure_ref: result.measure_ref,
              numerator: result.numerator,
              denominator: result.denominator,
              exclusion: result.exclusion,
            },
            input.tenant_id,
            input.period_start,
            input.period_end,
            // The handler only calls .query — a PoolClient is .query-compatible,
            // so gap inserts run in the same tenant transaction as the run.
            client as unknown as Pool,
            taskServiceUrl,
          );
        } catch {
          failed++;
        }
      }

      if (allResults.length > 0) {
        await persistSummaryMeasureReport(
          client,
          input.run_id,
          input.tenant_id,
          input.measure_ref,
          measureUrl,
          allResults,
          input.period_start,
          input.period_end,
        );
      }
    } else {
      // Legacy SQL path — unchanged
      for (const member of members) {
        try {
          const result = await evaluateMeasure(
            client,
            member,
            input.measure_ref,
            spec,
            input.period_start,
            input.period_end,
          );
          await persistMeasureReport(
            client,
            input.run_id,
            input.tenant_id,
            result,
            input.period_start,
            input.period_end,
          );
          await handleMeasureReportCompleted(
            {
              event_type: 'MeasureReportCompleted',
              run_id: input.run_id,
              member_id: result.member_id,
              measure_ref: result.measure_ref,
              numerator: result.numerator,
              denominator: result.denominator,
              exclusion: result.exclusion,
            },
            input.tenant_id,
            input.period_start,
            input.period_end,
            // The handler only calls .query — a PoolClient is .query-compatible,
            // so gap inserts run in the same tenant transaction as the run.
            client as unknown as Pool,
            taskServiceUrl,
          );
        } catch {
          failed++;
        }
      }
    }

    await client.query(
      `UPDATE qual.measure_run SET status = 'complete', completed_at = NOW() WHERE run_id = $1`,
      [input.run_id],
    );

    return { run_id: input.run_id, total: members.length, failed };
  });
}
