export interface OutreachTaskInput {
  tenant_id: string;
  gap_id: string;
  member_id: string;
  measure_ref: string;
  period_start: string;
  period_end: string;
}

export interface OutreachTaskResult {
  task_id: string;
}

export async function createOutreachTask(
  input: OutreachTaskInput,
  taskServiceUrl: string,
): Promise<OutreachTaskResult | null> {
  try {
    const res = await fetch(`${taskServiceUrl}/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sim-tenant-id': input.tenant_id },
      body: JSON.stringify({
        task_kind: 'quality-outreach',
        member_id: input.member_id,
        measure_ref: input.measure_ref,
        gap_id: input.gap_id,
        period: { start: input.period_start, end: input.period_end },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { task_id: string };
    return { task_id: data.task_id };
  } catch {
    return null;
  }
}
