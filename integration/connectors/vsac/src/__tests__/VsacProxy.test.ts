import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../VsacProxy.js';
import { VsacClient } from '../VsacClient.js';

describe('VsacProxy health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /vsac/sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const fakeValueSet = (oid: string) => ({
    oid,
    version: '2023-03',
    displayName: 'Test Value Set',
    concepts: [
      { code: '29881000', codeSystem: 'http://snomed.info/sct', displayName: 'Procedure A' },
      { code: '29882007', codeSystem: 'http://snomed.info/sct', displayName: 'Procedure B' },
    ],
  });

  it('happy path — all 4 OIDs sync successfully', async () => {
    vi.spyOn(VsacClient.prototype, 'expandValueSet').mockImplementation(async (oid: string) =>
      fakeValueSet(oid),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));

    const res = await request(app).post('/vsac/sync');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(4);
    expect(res.body.failed).toBe(0);
    expect(res.body.skipped).toBe(0);
  });

  it('VSAC failure degrades gracefully — 2 fail, 2 succeed', async () => {
    let callCount = 0;
    vi.spyOn(VsacClient.prototype, 'expandValueSet').mockImplementation(async (oid: string) => {
      callCount += 1;
      if (callCount <= 2) throw new Error('VSAC unavailable');
      return fakeValueSet(oid);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));

    const res = await request(app).post('/vsac/sync');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(2);
    expect(res.body.failed).toBe(2);
  });

  it('VKAS failure logged but sync continues — all 4 fail on upsert', async () => {
    vi.spyOn(VsacClient.prototype, 'expandValueSet').mockImplementation(async (oid: string) =>
      fakeValueSet(oid),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));

    const res = await request(app).post('/vsac/sync');
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(4);
    expect(res.body.synced).toBe(0);
  });
});
