import express from 'express';
import { VsacClient } from './VsacClient.js';
import type { Concept } from './types.js';

interface CacheEntry {
  concepts: Concept[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000;

function getCached(oid: string): Concept[] | null {
  const entry = cache.get(oid);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(oid);
    return null;
  }
  return entry.concepts;
}

function setCached(oid: string, concepts: Concept[]): void {
  cache.set(oid, { concepts, expiresAt: Date.now() + TTL_MS });
}

const vsacClient = new VsacClient({
  baseUrl: process.env['VSAC_BASE_URL'] ?? 'https://vsac.nlm.nih.gov/vsac/svs',
  apiKey: process.env['VSAC_API_KEY'] ?? '',
});

export const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/vsac/expand', async (req, res) => {
  const oid = req.query['oid'] as string | undefined;
  if (!oid) {
    return res.status(400).json({ error: 'Missing required query parameter: oid' });
  }

  const cached = getCached(oid);
  if (cached) {
    return res.json({ oid, concepts: cached, cached: true });
  }

  try {
    const valueSet = await vsacClient.expandValueSet(oid);
    setCached(oid, valueSet.concepts);
    return res.json({ oid, concepts: valueSet.concepts, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vsac-proxy] expansion failed for OID ${oid}:`, message);
    return res.status(502).json({ error: `VSAC expansion failed: ${message}` });
  }
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = parseInt(process.env['PORT'] ?? '3051', 10);
  app.listen(port, () => {
    console.log(`[vsac-proxy] Listening on port ${port}`);
  });
}
