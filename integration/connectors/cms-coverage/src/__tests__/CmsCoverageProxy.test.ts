import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../CmsCoverageProxy.js';
import { CmsCoverageClient } from '../CmsCoverageClient.js';
import * as ingester from '../NcdIngester.js';
import type { NcdRecord } from '../types.js';

const fakeNcd: NcdRecord = {
  ncdId: '150.3', title: 'Knee', effectiveDate: '2014-09-01',
  coverageIndicator: 'covered_with_limitations', procedureCodes: ['27447'], criteriaText: '',
};

afterEach(() => vi.restoreAllMocks());

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /ncd/sync', () => {
  it('returns synced/failed totals across all NCDs', async () => {
    vi.spyOn(CmsCoverageClient.prototype, 'fetchNcds').mockResolvedValue([fakeNcd]);
    vi.spyOn(ingester, 'ingestNcds').mockResolvedValue([
      { ncdId: '150.3', synced: 1, failed: 0, errors: [] },
    ]);
    const res = await request(app).post('/ncd/sync');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.results).toHaveLength(1);
  });

  it('returns 502 when CMS fetch throws', async () => {
    vi.spyOn(CmsCoverageClient.prototype, 'fetchNcds').mockRejectedValue(
      new Error('CMS NCD download failed: 503'),
    );
    const res = await request(app).post('/ncd/sync');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/CMS NCD download failed/);
  });

  it('accumulates synced and failed across multiple NCDs', async () => {
    vi.spyOn(CmsCoverageClient.prototype, 'fetchNcds').mockResolvedValue([
      fakeNcd, { ...fakeNcd, ncdId: 'B', procedureCodes: ['22857'] },
    ]);
    vi.spyOn(ingester, 'ingestNcds').mockResolvedValue([
      { ncdId: '150.3', synced: 1, failed: 0, errors: [] },
      { ncdId: 'B', synced: 0, failed: 1, errors: ['VKAS 500 for 22857'] },
    ]);
    const res = await request(app).post('/ncd/sync');
    expect(res.body.synced).toBe(1);
    expect(res.body.failed).toBe(1);
  });
});
