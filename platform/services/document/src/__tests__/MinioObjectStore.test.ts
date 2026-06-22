import { describe, it, expect, vi } from 'vitest';
import { MinioObjectStore } from '../store/MinioObjectStore.js';

function fakeClient() {
  return {
    putObject: vi.fn(async () => ({})),
    getObject: vi.fn(async () => (async function* () { yield Buffer.from('hello'); })()),
    removeObject: vi.fn(async () => {}),
  };
}

describe('MinioObjectStore', () => {
  it('put calls putObject with bucket/key/data/length', async () => {
    const c = fakeClient();
    const s = new MinioObjectStore(c as never, 'simintero-docs');
    await s.put('t1/docs/x', Buffer.from('abc'));
    expect(c.putObject).toHaveBeenCalledWith('simintero-docs', 't1/docs/x', expect.any(Buffer), 3);
  });
  it('get collects the stream into a Buffer', async () => {
    const c = fakeClient();
    const s = new MinioObjectStore(c as never, 'simintero-docs');
    const b = await s.get('t1/docs/x');
    expect(b.toString()).toBe('hello');
  });
});
