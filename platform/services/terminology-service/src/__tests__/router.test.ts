import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTerminologyRouter } from '../router.js';

const VS = {
  resourceType: 'ValueSet',
  url: 'http://example.org/vs/knee',
  expansion: { contains: [{ system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' }] },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createTerminologyRouter('http://vkas:3040'));
  return app;
}

// Resolve any URL containing 'knee' to VS; everything else 404s.
function stubVkas() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) =>
    u.includes('knee')
      ? { ok: true, status: 200, json: async () => ({ status: 'active', content: VS }) }
      : { ok: false, status: 404, json: async () => ({}) },
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /fhir/ValueSet/$validate-code', () => {
  it('400 when url is missing', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$validate-code');
    expect(res.status).toBe(400);
  });

  it('404 when the value-set is unresolved', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$validate-code?url=http://example.org/vs/bogus');
    expect(res.status).toBe(404);
  });

  it('200 result:true for a resolvable value-set with no code (probe)', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$validate-code?url=http://example.org/vs/knee');
    expect(res.status).toBe(200);
    expect(res.body.parameter).toContainEqual({ name: 'result', valueBoolean: true });
  });

  it('200 result:true with display for a member code', async () => {
    stubVkas();
    const res = await request(makeApp())
      .get('/fhir/ValueSet/$validate-code?url=http://example.org/vs/knee&system=http://snomed.info/sct&code=239873007');
    expect(res.status).toBe(200);
    expect(res.body.parameter).toContainEqual({ name: 'result', valueBoolean: true });
    expect(res.body.parameter).toContainEqual({ name: 'display', valueString: 'Osteoarthritis of knee' });
  });

  it('200 result:false for a non-member code', async () => {
    stubVkas();
    const res = await request(makeApp())
      .get('/fhir/ValueSet/$validate-code?url=http://example.org/vs/knee&system=http://snomed.info/sct&code=000000');
    expect(res.status).toBe(200);
    expect(res.body.parameter).toContainEqual({ name: 'result', valueBoolean: false });
    expect(res.body.parameter.find((p: { name: string }) => p.name === 'display')).toBeUndefined();
  });
});

describe('GET /fhir/ValueSet/$expand', () => {
  it('400 when url is missing', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$expand');
    expect(res.status).toBe(400);
  });
  it('404 when unresolved', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$expand?url=http://example.org/vs/bogus');
    expect(res.status).toBe(404);
  });
  it('200 returns the value-set with concepts', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$expand?url=http://example.org/vs/knee');
    expect(res.status).toBe(200);
    expect(res.body.expansion.contains).toHaveLength(1);
  });
});
