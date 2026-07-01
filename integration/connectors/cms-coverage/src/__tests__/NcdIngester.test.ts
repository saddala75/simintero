import { describe, it, expect, vi, afterEach } from 'vitest';
import { ingestNcds } from '../NcdIngester.js';
import type { NcdRecord } from '../types.js';

const knee: NcdRecord = {
  ncdId: '150.3', title: 'Total Knee Arthroplasty', effectiveDate: '2014-09-01',
  coverageIndicator: 'covered_with_limitations', procedureCodes: ['27447', '27445'],
  criteriaText: 'Coverage is limited...',
};

afterEach(() => vi.restoreAllMocks());

describe('ingestNcds', () => {
  it('posts one VKAS artifact per procedure code — create+submit+activate', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => {
      urls.push(u);
      return { ok: true, status: 201 };
    }));
    const results = await ingestNcds([knee], 'http://vkas:3040');
    expect(results[0].synced).toBe(2);
    expect(results[0].failed).toBe(0);
    // 2 codes × 3 calls (create + submit + activate) = 6 fetch calls
    expect(urls).toHaveLength(6);
    expect(urls.filter(u => u.endsWith('/v1/artifacts') && !u.includes('submit') && !u.includes('activate'))).toHaveLength(2);
    expect(urls.filter(u => u.endsWith('/v1/artifacts/submit'))).toHaveLength(2);
    expect(urls.filter(u => u.endsWith('/v1/artifacts/activate'))).toHaveLength(2);
  });

  it('409 on create is idempotent — counts as synced, no submit/activate', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string) => {
      urls.push(u);
      return { ok: false, status: 409 };
    }));
    const results = await ingestNcds([{ ...knee, procedureCodes: ['27447'] }], 'http://vkas:3040');
    expect(results[0].synced).toBe(1);
    expect(results[0].failed).toBe(0);
    expect(urls).toHaveLength(1);  // only create, no submit/activate
  });

  it('artifact shape is correct for covered_with_limitations', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string, o: RequestInit) => {
      if (!u.includes('/submit') && !u.includes('/activate')) {
        body = JSON.parse(o.body as string);
      }
      return { ok: true, status: 201 };
    }));
    await ingestNcds([{ ...knee, procedureCodes: ['27447'] }], 'http://vkas:3040');
    expect(body).toMatchObject({
      canonical_url: 'urn:cms:ncd:procedure:27447',
      version: '2014-09-01',
      tenant_id: 'shared',
      artifact_type: 'coverage_rule',
      status: 'active',
      created_by: 'ncd-sync',
      content: {
        source_type: 'ncd',
        procedure_codes: ['27447'],
        pa_required: true,
        coverage_indicator: 'covered_with_limitations',
        ncd_id: '150.3',
        elm_ref: null,
        elm_version: null,
        evidence_requirements: [],
        relations: [],
      },
    });
  });

  it('pa_required is false for covered', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string, o: RequestInit) => {
      if (!u.includes('/submit') && !u.includes('/activate')) {
        body = JSON.parse(o.body as string);
      }
      return { ok: true, status: 201 };
    }));
    await ingestNcds([{ ...knee, coverageIndicator: 'covered', procedureCodes: ['99213'] }], 'http://vkas:3040');
    expect((body as { content: { pa_required: boolean } }).content.pa_required).toBe(false);
  });

  it('pa_required is false for non_covered', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (u: string, o: RequestInit) => {
      if (!u.includes('/submit') && !u.includes('/activate')) {
        body = JSON.parse(o.body as string);
      }
      return { ok: true, status: 201 };
    }));
    await ingestNcds([{ ...knee, coverageIndicator: 'non_covered', procedureCodes: ['22857'] }], 'http://vkas:3040');
    expect((body as { content: { pa_required: boolean } }).content.pa_required).toBe(false);
  });

  it('per-code failure isolation — VKAS 500 on first code does not abort second', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      // First call is create for code 1 → 500 (failed, no submit/activate)
      // Second call is create for code 2 → 201
      // Third call is submit for code 2 → 200
      // Fourth call is activate for code 2 → 200
      if (calls === 1) return { ok: false, status: 500 };
      return { ok: true, status: calls === 2 ? 201 : 200 };
    }));
    const results = await ingestNcds([knee], 'http://vkas:3040');
    expect(results[0].synced).toBe(1);
    expect(results[0].failed).toBe(1);
    expect(calls).toBe(4);  // create(fail) + create + submit + activate
  });

  it('NCD with no procedure codes returns synced=0 failed=0', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const results = await ingestNcds([{ ...knee, procedureCodes: [] }], 'http://vkas:3040');
    expect(results[0].synced).toBe(0);
    expect(results[0].failed).toBe(0);
  });
});
