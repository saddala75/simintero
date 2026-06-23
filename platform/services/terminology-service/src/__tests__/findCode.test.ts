import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { findCodeInContains } from '../findCode.js';
import { createTerminologyRouter } from '../router.js';

// ---- seeded knee contains (mirrors V022) ----

const KNEE_CONTAINS = [
  { system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' },
  { system: 'http://snomed.info/sct', code: '30989003', display: 'Knee pain' },
  { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'M17.0', display: 'Bilateral primary osteoarthritis of knee' },
];

// ---- full V022-fixture contains (used by token-subset tests) ----

const V022_CONTAINS = [
  { system: 'http://snomed.info/sct', code: '239873007', display: 'Osteoarthritis of knee' },
  { system: 'http://snomed.info/sct', code: '30989003', display: 'Knee pain' },
  { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'M17.0', display: 'Bilateral primary osteoarthritis of knee' },
  { system: 'http://www.ama-assn.org/go/cpt', code: '99213', display: 'Office or other outpatient visit, established patient' },
];

// ---- pure matcher tests ----

describe('findCodeInContains (pure matcher)', () => {
  it('returns the matching entry for an exact display (case-insensitive)', () => {
    const result = findCodeInContains('osteoarthritis of knee', KNEE_CONTAINS);
    expect(result).toEqual({
      system: 'http://snomed.info/sct',
      code: '239873007',
      display: 'Osteoarthritis of knee',
    });
  });

  it('matches despite extra whitespace and uppercase', () => {
    const result = findCodeInContains('OSTEOARTHRITIS OF KNEE ', KNEE_CONTAINS);
    expect(result).toEqual({
      system: 'http://snomed.info/sct',
      code: '239873007',
      display: 'Osteoarthritis of knee',
    });
  });

  it('returns null when no entry matches', () => {
    const result = findCodeInContains('nonsense xyz', KNEE_CONTAINS);
    expect(result).toBeNull();
  });
});

// ---- token-subset matcher tests (slice 2.4a tightening) ----

describe('findCodeInContains (token-subset tightening)', () => {
  it('exact match: "osteoarthritis of knee" → SNOMED 239873007', () => {
    const result = findCodeInContains('osteoarthritis of knee', V022_CONTAINS);
    expect(result).toMatchObject({ code: '239873007', system: 'http://snomed.info/sct' });
  });

  it('token-subset match: "knee pain in the left leg" → SNOMED 30989003 "Knee pain"', () => {
    const result = findCodeInContains('knee pain in the left leg', V022_CONTAINS);
    expect(result).toMatchObject({ code: '30989003', system: 'http://snomed.info/sct' });
  });

  it('bare anatomy word "knee" → null (display sig tokens not all in query)', () => {
    const result = findCodeInContains('knee', V022_CONTAINS);
    expect(result).toBeNull();
  });

  it('bare symptom word "pain" → null ({knee,pain} ⊄ {pain})', () => {
    const result = findCodeInContains('pain', V022_CONTAINS);
    expect(result).toBeNull();
  });

  it('stopword "of" → null', () => {
    const result = findCodeInContains('of', V022_CONTAINS);
    expect(result).toBeNull();
  });

  it('stopword "a" → null', () => {
    const result = findCodeInContains('a', V022_CONTAINS);
    expect(result).toBeNull();
  });

  it('partial content word "visit" → null (does not contain all sig tokens of CPT display)', () => {
    const result = findCodeInContains('visit', V022_CONTAINS);
    expect(result).toBeNull();
  });

  it('empty display concept is never matched by a non-empty query', () => {
    const withEmpty = [...V022_CONTAINS, { system: 'http://snomed.info/sct', code: 'EMPTY', display: '' }];
    const result = findCodeInContains('osteoarthritis of knee', withEmpty);
    // Should match the real entry, not the empty one, and the empty one should never be a target
    expect(result).toMatchObject({ code: '239873007' });
    // Querying something unique to the empty slot should also return null
    expect(findCodeInContains('empty', withEmpty)).toBeNull();
  });
});

// ---- route integration tests ----

const KNEE_VS = {
  resourceType: 'ValueSet',
  url: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498',
  expansion: { contains: KNEE_CONTAINS },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createTerminologyRouter('http://vkas:3040'));
  return app;
}

// Resolve the seeded knee URL (identified by OID suffix in the encoded query param);
// return 404 for everything else so the other two seeded sets resolve to null gracefully.
function stubVkas() {
  vi.stubGlobal('fetch', vi.fn(async (u: string) =>
    u.includes('3.526.3.1498')
      ? { ok: true, status: 200, json: async () => ({ status: 'active', content: KNEE_VS }) }
      : { ok: false, status: 404, json: async () => ({}) },
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /fhir/ValueSet/$find-code', () => {
  it('400 when text is missing', async () => {
    stubVkas();
    const res = await request(makeApp()).get('/fhir/ValueSet/$find-code');
    expect(res.status).toBe(400);
  });

  it('200 found:true with correct code+system when text matches a seeded concept', async () => {
    stubVkas();
    const res = await request(makeApp())
      .get('/fhir/ValueSet/$find-code?text=osteoarthritis%20of%20knee');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.system).toBe('http://snomed.info/sct');
    expect(res.body.code).toBe('239873007');
    expect(res.body.display).toBe('Osteoarthritis of knee');
  });

  it('200 found:false when text does not match any seeded concept', async () => {
    stubVkas();
    const res = await request(makeApp())
      .get('/fhir/ValueSet/$find-code?text=nonsense');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('200 found:true when scoped to an explicit url that contains the match', async () => {
    stubVkas();
    const kneeUrl = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498';
    const res = await request(makeApp())
      .get(`/fhir/ValueSet/$find-code?text=osteoarthritis%20of%20knee&url=${encodeURIComponent(kneeUrl)}`);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.code).toBe('239873007');
  });
});
