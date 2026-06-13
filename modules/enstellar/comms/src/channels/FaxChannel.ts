const NOTIFICATION_URL = process.env['NOTIFICATION_URL'] ?? 'http://localhost:4041';

export async function sendViaFax(commId: string, payload: unknown): Promise<void> {
  try {
    const resp = await fetch(`${NOTIFICATION_URL}/v1/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comm_id: commId, channel: 'fax', payload }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      console.warn(`[FaxChannel] notification service returned ${resp.status} for comm ${commId}`);
    }
  } catch {
    console.warn(`[FaxChannel] notification service unreachable for comm ${commId}`);
  }
}
