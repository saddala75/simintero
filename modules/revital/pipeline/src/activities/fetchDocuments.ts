export interface DocMeta {
  doc_id: string;
  virus_scan_status: string;
  text_key: string | null;
  object_key: string;
}

export async function fetchDocumentsImpl(
  docRefs: string[],
  unprocessed: Array<{ ref: string; reason: string }>,
  docServiceUrl: string,
): Promise<DocMeta[]> {
  const results: DocMeta[] = [];
  for (const ref of docRefs) {
    try {
      const res = await fetch(`${docServiceUrl}/documents/${ref}/metadata`);
      if (!res.ok) {
        unprocessed.push({ ref, reason: res.status === 404 ? 'not_found' : `http_${res.status}` });
        continue;
      }
      const meta = (await res.json()) as DocMeta;
      if (meta.virus_scan_status === 'quarantined') {
        unprocessed.push({ ref, reason: 'quarantined' });
        continue;
      }
      results.push(meta);
    } catch {
      unprocessed.push({ ref, reason: 'fetch_error' });
    }
  }
  return results;
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070';

export async function fetchDocuments(
  docRefs: string[],
  unprocessed: Array<{ ref: string; reason: string }>,
): Promise<DocMeta[]> {
  return fetchDocumentsImpl(docRefs, unprocessed, DOC_SERVICE_URL);
}
