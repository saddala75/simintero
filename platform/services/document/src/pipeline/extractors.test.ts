import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectFormat, extractSpans } from './extractors.js';
import type { ExtractedSpan } from './extractors.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'tests', 'fixtures');
const fixture = (name: string) => readFileSync(join(fixtures, name));

describe('detectFormat', () => {
  it('detects pdf / c-cda / fhir-json / other by magic bytes', () => {
    expect(detectFormat(fixture('sample.pdf'))).toBe('pdf');
    expect(detectFormat(fixture('sample-ccda.xml'))).toBe('c-cda');
    expect(detectFormat(Buffer.from('{"resourceType":"DocumentReference"}'))).toBe('fhir-json');
    expect(detectFormat(Buffer.from('hello world'))).toBe('other');
  });
});

describe('FHIR-Binary recursion depth cap', () => {
  /** Build a chain of `levels` DocumentReferences, each wrapping the next via
   *  base64 attachment.data. The innermost payload is a QuestionnaireResponse
   *  with actual items so it would return 'extracted' if reached — this means
   *  any result OTHER than 'extracted' from a deep chain proves the cap fired. */
  function makeNestedDocRef(levels: number): Buffer {
    // Innermost: a QR that would extract successfully if reached
    let inner: string = JSON.stringify({
      resourceType: 'QuestionnaireResponse',
      item: [{ answer: [{ valueString: 'leaf-answer' }] }],
    });
    for (let i = 0; i < levels; i++) {
      const wrapper = {
        resourceType: 'DocumentReference',
        content: [{ attachment: { data: Buffer.from(inner).toString('base64') } }],
      };
      inner = JSON.stringify(wrapper);
    }
    return Buffer.from(inner);
  }

  it('shallow wrap (1 level) reaches the inner QR and extracts successfully', async () => {
    // depth=1: one DocumentReference wrapping a QR with items → should extract
    const bytes = makeNestedDocRef(1);
    const r = await extractSpans(bytes, 'fhir-json');
    expect(r.status).toBe('extracted');
    expect(r.text).toContain('leaf-answer');
  });

  it('returns unsupported (cap) when FHIR nesting exceeds depth limit (4 levels)', async () => {
    // 4 levels deep: exceeds the cap of 3, so the cap fires before reaching the QR leaf.
    // The cap must return 'unsupported', NOT 'extracted' (which is what the leaf would give).
    const bytes = makeNestedDocRef(4);
    const r = await extractSpans(bytes, 'fhir-json');
    // Without a cap, this would return 'extracted' (the inner QR is reachable).
    // With the cap at depth 3, this must NOT be 'extracted'.
    expect(r.status).toBe('unsupported');
  });

  it('returns unsupported at exactly depth=4 (cap boundary)', async () => {
    const bytes = makeNestedDocRef(4);
    const r = await extractSpans(bytes, 'fhir-json');
    expect(r.status).toBe('unsupported');
  });
});

describe('extractSpans', () => {
  it('extracts text-layer PDF into per-page spans', async () => {
    const r = await extractSpans(fixture('sample.pdf'), 'pdf');
    expect(r.status).toBe('extracted');
    expect(r.spans.length).toBeGreaterThanOrEqual(2);
    expect(new Set(r.spans.map((s: ExtractedSpan) => s.page)).size).toBeGreaterThanOrEqual(2);
    expect(
      r.spans.every((s: ExtractedSpan) => s.text.length > 0 && s.excerpt_hash.startsWith('sha256:')),
    ).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('extracts C-CDA sections into spans (page = section ordinal)', async () => {
    const r = await extractSpans(fixture('sample-ccda.xml'), 'c-cda');
    expect(r.status).toBe('extracted');
    expect(r.spans.length).toBeGreaterThanOrEqual(2);
    expect(r.spans.map((s: ExtractedSpan) => s.page)).toEqual(expect.arrayContaining([1, 2]));
    expect(r.spans.some((s: ExtractedSpan) => s.text.includes('Osteoarthritis'))).toBe(true);
    expect(r.spans.every((s: ExtractedSpan) => s.excerpt_hash.startsWith('sha256:'))).toBe(true);
  });

  it('flags an image-only PDF (no text layer) as needs_ocr', async () => {
    const r = await extractSpans(fixture('image-only.pdf'), 'pdf');
    expect(r.status).toBe('needs_ocr');
    expect(r.spans.length).toBe(0);
  });
});
