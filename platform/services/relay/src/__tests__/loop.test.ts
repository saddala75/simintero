import { describe, it, expect, vi } from 'vitest';
import { relayTick } from '../loop.js';

describe('relayTick', () => {
  it('delegates to relayBatch and returns the count', async () => {
    const relayBatch = vi.fn(async () => 3);
    const n = await relayTick({ db: {} as never, producer: {} as never, batchSize: 100, relayBatch });
    expect(n).toBe(3);
    expect(relayBatch).toHaveBeenCalledWith({}, {}, 100);
  });
});
