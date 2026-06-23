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
