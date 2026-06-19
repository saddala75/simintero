import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveValueSet } from '../vkas.js';

const VS = {
  resourceType: 'ValueSet',
  url: 'http://example.org/vs/x',
  expansion: { contains: [{ system: 'http://snomed.info/sct', code: '1', display: 'One' }] },
};

afterEach(() => vi.unstubAllGlobals());

describe('resolveValueSet', () => {
  it('returns content on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ status: 'active', content: VS }),
    })));
    const res = await resolveValueSet('http://vkas:3040', 'http://example.org/vs/x');
    expect(res).toEqual(VS);
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const res = await resolveValueSet('http://vkas:3040', 'http://example.org/vs/missing');
    expect(res).toBeNull();
  });

  it('returns null on network error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const res = await resolveValueSet('http://vkas:3040', 'http://example.org/vs/x');
    expect(res).toBeNull();
  });

  it('builds the resolve URL with the canonical_url query param', async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'active', content: VS }) }));
    vi.stubGlobal('fetch', spy);
    await resolveValueSet('http://vkas:3040', 'http://example.org/vs/x');
    expect(spy).toHaveBeenCalledWith(
      'http://vkas:3040/v1/artifacts:resolve?canonical_url=http%3A%2F%2Fexample.org%2Fvs%2Fx',
    );
  });
});
