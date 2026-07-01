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
  it('posts one VKAS artifact per procedure code', async () => {
    const posts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, o: RequestInit) => {
      posts.push(JSON.parse(o.body as string));
      return { ok: true, status: 201 };
    }));
    const results = await ingestNcds([knee], 'http://vkas:3040');
    expect(results[0].synced).toBe(2);
    expect(results[0].failed).toBe(0);
    expect(posts).toHaveLength(2);
  });

  it('artifact shape is correct for covered_with_limitations', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, o: RequestInit) => {
      body = JSON.parse(o.body as string);
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
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, o: RequestInit) => {
      body = JSON.parse(o.body as string); return { ok: true, status: 201 };
    }));
    await ingestNcds([{ ...knee, coverageIndicator: 'covered', procedureCodes: ['99213'] }], 'http://vkas:3040');
    expect((body as { content: { pa_required: boolean } }).content.pa_required).toBe(false);
  });

  it('pa_required is false for non_covered', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, o: RequestInit) => {
      body = JSON.parse(o.body as string); return { ok: true, status: 201 };
    }));
    await ingestNcds([{ ...knee, coverageIndicator: 'non_covered', procedureCodes: ['22857'] }], 'http://vkas:3040');
    expect((body as { content: { pa_required: boolean } }).content.pa_required).toBe(false);
  });

  it('per-code failure isolation — VKAS 500 on first code does not abort second', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++;
      return calls === 1 ? { ok: false, status: 500 } : { ok: true, status: 201 };
    }));
    const results = await ingestNcds([knee], 'http://vkas:3040');
    expect(results[0].synced).toBe(1);
    expect(results[0].failed).toBe(1);
    expect(calls).toBe(2);
  });

  it('NCD with no procedure codes returns synced=0 failed=0', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const results = await ingestNcds([{ ...knee, procedureCodes: [] }], 'http://vkas:3040');
    expect(results[0].synced).toBe(0);
    expect(results[0].failed).toBe(0);
  });
});
