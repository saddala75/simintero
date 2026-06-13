import { describe, it, expect, vi } from 'vitest';
import { computeMargin } from '../workers/MarginComputeWorker.js';

function makePool(responses: Array<{ rows: unknown[] }>) {
  let i = 0;
  return { query: vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [] })) } as any;
}

describe('computeMargin', () => {
  it('computes cost from outbox and passes it to the INSERT', async () => {
    const pool = makePool([
      { rows: [{ total_cost: '123.45' }] }, // SELECT response
      { rows: [] },                          // INSERT response
    ]);

    await computeMargin(pool, 'tenant-1', '2025-01-01', '2025-02-01');

    const insertParams = pool.query.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain(123.45);
  });

  it('calls pool.query twice — once for SELECT and once for INSERT', async () => {
    const pool = makePool([
      { rows: [{ total_cost: '50.00' }] },
      { rows: [] },
    ]);

    await computeMargin(pool, 'tenant-2', '2025-01-01', '2025-02-01');

    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('handles empty cost period — INSERT is still called with cost 0', async () => {
    const pool = makePool([
      { rows: [{ total_cost: '0' }] },
      { rows: [] },
    ]);

    await computeMargin(pool, 'tenant-3', '2025-03-01', '2025-04-01');

    expect(pool.query).toHaveBeenCalledTimes(2);
    const insertParams = pool.query.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain(0);
  });

  it('INSERT SQL contains ON CONFLICT DO NOTHING for idempotency', async () => {
    const pool = makePool([
      { rows: [{ total_cost: '99.99' }] },
      { rows: [] },
    ]);

    await computeMargin(pool, 'tenant-4', '2025-05-01', '2025-06-01');

    const insertSql = pool.query.mock.calls[1][0] as string;
    expect(insertSql).toContain('ON CONFLICT DO NOTHING');
  });
});
