import type { Pool, PoolClient } from 'pg'

const EXECUTION_URL =
  process.env['QUALITRON_EXECUTION_URL'] ?? 'http://localhost:4020'

// Role used for cross-tenant batch scans — mirrors the Python relay_db_role pattern.
// sim_relay has BYPASSRLS, allowing it to read qual.measure_definition across all
// tenants. sim_app (the normal app role) has NOBYPASSRLS: FORCE RLS on
// qual.measure_definition returns zero rows when current_setting('sim.tenant_id')
// is NULL (as it is in a scheduled batch context).
const RELAY_DB_ROLE = process.env['RELAY_DB_ROLE'] ?? 'sim_relay'

export async function triggerBatchRuns(pool: Pool): Promise<void> {
  // Acquire a client and SET ROLE to the BYPASSRLS relay role so FORCE RLS on
  // qual.measure_definition does not filter out all rows.
  const client: PoolClient = await pool.connect()
  let rows: Array<{ measure_ref: string; version: string; tenant_id: string }> = []
  try {
    await client.query(`SET ROLE "${RELAY_DB_ROLE}"`)
    const result = await client.query<{
      measure_ref: string
      version: string
      tenant_id: string
    }>(
      `SELECT measure_ref, version, tenant_id
       FROM qual.measure_definition
       WHERE digicore_library_ref IS NOT NULL`,
    )
    rows = result.rows
  } finally {
    // Always reset the role before releasing so the connection returns to the
    // pool in its original state (sim_app).
    try {
      await client.query('RESET ROLE')
    } catch {
      // ignore — connection may be broken; pool will discard it
    }
    client.release()
  }

  const periodStart = `${new Date().getFullYear()}-01-01`
  const periodEnd = new Date().toISOString().split('T')[0]!

  for (const row of rows) {
    try {
      const res = await fetch(`${EXECUTION_URL}/v1/quality/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sim-tenant-id': row.tenant_id,
        },
        body: JSON.stringify({
          measure_ref: row.measure_ref,
          measure_version: row.version,
          period_start: periodStart,
          period_end: periodEnd,
        }),
      })
      if (!res.ok) {
        console.error(
          `MeasureBatchSchedule: non-OK response ${res.status} for ${row.measure_ref} (tenant ${row.tenant_id})`,
        )
      }
    } catch (err) {
      console.error(
        `MeasureBatchSchedule: failed to trigger run for ${row.measure_ref} (tenant ${row.tenant_id}):`,
        err,
      )
    }
  }
}

// Returns the interval handle so callers can clear it in tests
export function scheduleDailyBatch(pool: Pool): ReturnType<typeof setInterval> {
  const MS_24H = 24 * 60 * 60 * 1000
  return setInterval(() => {
    triggerBatchRuns(pool).catch(err =>
      console.error('MeasureBatchSchedule: batch run error:', err),
    )
  }, MS_24H)
}
