import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export type DocFormat = 'pdf' | 'c-cda' | 'fhir-json' | 'other';

export interface ExtractedSpan {
  seq: number;
  page: number;
  region: [number, number, number, number];
  text: string;
  excerpt_hash: string;
}

export interface ExtractResult {
  status: 'extracted' | 'needs_ocr' | 'extract_failed' | 'unsupported';
  text: string;
  spans: ExtractedSpan[];
}

export interface ExtractOpts {
  ocrEndpoint?: string;
}

function hashText(text: string): string {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Detect a document's format by magic bytes / leading content. Pure, no I/O.
 */
export function detectFormat(bytes: Buffer): DocFormat {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    return bytes.toString('utf8').includes('ClinicalDocument') ? 'c-cda' : 'other';
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      const j = JSON.parse(bytes.toString('utf8'));
      if (j && typeof j === 'object' && 'resourceType' in j) return 'fhir-json';
    } catch {
      /* not JSON */
    }
  }
  return 'other';
}

/** Maximum number of recursive FHIR-Binary unwrap steps before giving up. */
const FHIR_MAX_DEPTH = 3;

/**
 * Extract structured spans from a document. Pure (no DB / object store); the
 * only side effect is an optional OCR POST when `opts.ocrEndpoint` is set and
 * a PDF has no text layer.
 *
 * The optional `_depth` parameter is an internal recursion counter used to cap
 * FHIR DocumentReference attachment unwrapping. Callers should omit it; the
 * default of 0 is correct for all external call sites.
 */
export async function extractSpans(
  bytes: Buffer,
  format: DocFormat,
  opts?: ExtractOpts,
  _depth = 0,
): Promise<ExtractResult> {
  if (_depth >= FHIR_MAX_DEPTH) {
    return { status: 'unsupported', text: '', spans: [] };
  }
  try {
    if (format === 'pdf') return await extractPdf(bytes, opts);
    if (format === 'c-cda') return extractCcda(bytes);
    if (format === 'fhir-json') return await extractFhirJson(bytes, opts, _depth);
    return { status: 'unsupported', text: '', spans: [] };
  } catch {
    return { status: 'extract_failed', text: '', spans: [] };
  }
}

// ---------------------------------------------------------------------------
// PDF (text-layer) — pdfjs-dist legacy/node build, runs workerless in-process.
// ---------------------------------------------------------------------------

async function extractPdf(bytes: Buffer, opts?: ExtractOpts): Promise<ExtractResult> {
  // Import the legacy (Node) build lazily so the module stays importable in
  // any context; the legacy build runs without a Web Worker / DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const getDocument = pdfjs.getDocument as typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument;

  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const spans: ExtractedSpan[] = [];
  const pageTexts: string[] = [];
  let seq = 0;

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const lineParts: string[] = [];
      for (const item of content.items) {
        // TextMarkedContent items have no `str`; skip them.
        if (!('str' in item)) continue;
        const str = item.str;
        if (!str || str.trim().length === 0) continue;
        const transform = item.transform as number[];
        const x = transform[4] ?? 0;
        const y = transform[5] ?? 0;
        const width = item.width ?? 0;
        const height = item.height || 10;
        spans.push({
          seq: seq++,
          page: pageNum,
          region: [x, y, x + width, y + height],
          text: str,
          excerpt_hash: hashText(str),
        });
        lineParts.push(str);
      }
      pageTexts.push(lineParts.join(' '));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  if (spans.length === 0) {
    if (opts?.ocrEndpoint) {
      return await ocrFallback(bytes, opts.ocrEndpoint);
    }
    return { status: 'needs_ocr', text: '', spans: [] };
  }

  return { status: 'extracted', text: pageTexts.join('\n'), spans };
}

async function ocrFallback(bytes: Buffer, endpoint: string): Promise<ExtractResult> {
  // Minimal OCR hand-off: POST the bytes to the configured endpoint. The OCR
  // service is expected to return { text, spans } in the same span shape.
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) return { status: 'needs_ocr', text: '', spans: [] };
  const body = (await res.json()) as { text?: string; spans?: ExtractedSpan[] };
  const spans = Array.isArray(body.spans) ? body.spans : [];
  return { status: 'extracted', text: body.text ?? '', spans };
}

// ---------------------------------------------------------------------------
// C-CDA — fast-xml-parser; one span per <section> (page = section ordinal).
// ---------------------------------------------------------------------------

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Flatten arbitrary parsed-XML value (string | object | array) to plain text. */
function flattenText(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (typeof node === 'object') {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith('@_')) continue; // skip attributes
      parts.push(flattenText(value));
    }
    return parts.join(' ');
  }
  return '';
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractCcda(bytes: Buffer): ExtractResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
  });
  const parsed = parser.parse(bytes.toString('utf8')) as Record<string, unknown>;
  const clinicalDocument = parsed.ClinicalDocument as Record<string, unknown> | undefined;
  if (!clinicalDocument) return { status: 'unsupported', text: '', spans: [] };

  const topComponent = clinicalDocument.component as Record<string, unknown> | undefined;
  const structuredBody = topComponent?.structuredBody as Record<string, unknown> | undefined;
  const components = asArray(structuredBody?.component) as Array<Record<string, unknown>>;

  const spans: ExtractedSpan[] = [];
  const textParts: string[] = [];
  let seq = 0;

  for (let i = 0; i < components.length; i++) {
    const section = components[i]?.section as Record<string, unknown> | undefined;
    if (!section) continue;
    const title = flattenText(section.title);
    const narrative = flattenText(section.text);
    const text = normalizeWhitespace([title, narrative].filter(Boolean).join(': '));
    if (!text) continue;
    spans.push({
      seq: seq++,
      page: i + 1,
      region: [0, 0, 0, 0],
      text,
      excerpt_hash: hashText(text),
    });
    textParts.push(text);
  }

  if (spans.length === 0) return { status: 'unsupported', text: '', spans: [] };
  return { status: 'extracted', text: textParts.join('\n'), spans };
}

// ---------------------------------------------------------------------------
// FHIR JSON — best-effort narrative extraction.
// ---------------------------------------------------------------------------

function flattenFhirAnswers(items: unknown, out: string[]): void {
  for (const item of asArray(items) as Array<Record<string, unknown>>) {
    for (const answer of asArray(item.answer) as Array<Record<string, unknown>>) {
      for (const key of Object.keys(answer)) {
        if (key.startsWith('value')) out.push(String(answer[key]));
      }
    }
    if (item.item) flattenFhirAnswers(item.item, out);
  }
}

async function extractFhirJson(bytes: Buffer, opts?: ExtractOpts, depth = 0): Promise<ExtractResult> {
  const resource = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  const resourceType = resource.resourceType as string | undefined;

  // DocumentReference with an embedded base64 attachment -> decode + recurse.
  // Pass depth + 1 so the cap in extractSpans fires after FHIR_MAX_DEPTH hops.
  if (resourceType === 'DocumentReference') {
    const contents = asArray(resource.content) as Array<Record<string, unknown>>;
    for (const c of contents) {
      const attachment = c.attachment as Record<string, unknown> | undefined;
      const data = attachment?.data as string | undefined;
      if (data) {
        const decoded = Buffer.from(data, 'base64');
        return await extractSpans(decoded, detectFormat(decoded), opts, depth + 1);
      }
    }
  }

  // QuestionnaireResponse -> flatten item answers into text spans.
  if (resourceType === 'QuestionnaireResponse') {
    const answers: string[] = [];
    flattenFhirAnswers(resource.item, answers);
    if (answers.length > 0) {
      const text = answers.join('\n');
      return {
        status: 'extracted',
        text,
        spans: [{ seq: 0, page: 1, region: [0, 0, 0, 0], text, excerpt_hash: hashText(text) }],
      };
    }
  }

  return { status: 'unsupported', text: '', spans: [] };
}
