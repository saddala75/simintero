import crypto from 'node:crypto';
import type { DocMeta } from './fetchDocuments.js';

export interface Span {
  page: number;
  region: [number, number, number, number];
  text: string;
  hash: string;
}

export type SpanMap = Record<string, Span[]>;

export async function parseSegmentImpl(
  docs: DocMeta[],
  docServiceUrl: string,
  tenantId: string,
): Promise<SpanMap> {
  const spanMap: SpanMap = {};

  for (const doc of docs) {
    try {
      const res = await fetch(`${docServiceUrl}/documents/${doc.doc_id}/span?page=1&region=0,0,612,792`, {
        headers: { 'x-sim-tenant-id': tenantId },
      });
      if (!res.ok) { spanMap[doc.doc_id] = []; continue; }
      const text = await res.text();
      const hash = `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
      // Phase 2: treat each non-empty line as a span (real PDF parsing is Phase 3)
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      spanMap[doc.doc_id] = lines.map((line, i) => ({
        page: 1,
        region: [0, i * 12, 612, (i + 1) * 12] as [number, number, number, number],
        text: line,
        hash,
      }));
    } catch {
      spanMap[doc.doc_id] = [];
    }
  }
  return spanMap;
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070';

export async function parseSegment(docs: DocMeta[], tenantId: string): Promise<SpanMap> {
  return parseSegmentImpl(docs, DOC_SERVICE_URL, tenantId);
}
