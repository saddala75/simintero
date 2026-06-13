/**
 * clockState projection — queries ens.clock rows for a given case.
 *
 * Phase 1: accepts a pg Pool/Client and returns clock rows.
 * The caller is responsible for setting sim.tenant_id on the connection
 * so Row Level Security enforces tenant isolation.
 */

export interface ClockRow {
  clock_id: string;
  case_id: string;
  tenant_id: string;
  profile_pin: unknown;
  type: 'standard' | 'expedited' | 'rfi_hold' | 'appeal';
  started_at: Date;
  limit_value: { value: number; unit: 'business_days' | 'hours' | 'calendar_days' };
  elapsed_banked: string; // Postgres INTERVAL as string
  state: 'running' | 'paused' | 'satisfied' | 'breached';
  pause_history: unknown[];
}

export interface DbClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Returns all clock rows for a given case_id.
 * Relies on RLS tenant_isolation policy — set sim.tenant_id before calling.
 */
export async function getClocksByCase(
  db: DbClient,
  caseId: string,
): Promise<ClockRow[]> {
  const result = await db.query<ClockRow>(
    'SELECT * FROM ens.clock WHERE case_id = $1 ORDER BY started_at ASC',
    [caseId],
  );
  return result.rows;
}

/**
 * Returns a single clock row by clock_id.
 */
export async function getClockById(
  db: DbClient,
  clockId: string,
): Promise<ClockRow | undefined> {
  const result = await db.query<ClockRow>(
    'SELECT * FROM ens.clock WHERE clock_id = $1',
    [clockId],
  );
  return result.rows[0];
}
