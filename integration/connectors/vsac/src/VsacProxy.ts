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

const vkasBaseUrl = process.env['VKAS_BASE_URL'] ?? 'http://vkas:3040';

const PA_VALUE_SET_OIDS = [
  { oid: '2.16.840.1.113883.3.526.3.1534', label: 'knee-arthroscopy-procedures' },
  { oid: '2.16.840.1.113883.3.526.3.396',  label: 'lumbar-spine-mri-indications' },
  { oid: '2.16.840.1.113883.3.526.3.1008', label: 'upper-endoscopy-procedures' },
  { oid: '2.16.840.1.113883.3.526.3.1285', label: 'ct-abdomen-pelvis-procedures' },
] as const;

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

type SyncResultEntry =
  | { oid: string; label: string; status: 'synced' }
  | { oid: string; label: string; status: 'failed'; error: string };

app.post('/vsac/sync', async (_req, res) => {
  const results: SyncResultEntry[] = [];

  for (const entry of PA_VALUE_SET_OIDS) {
    const { oid, label } = entry;

    let valueSet;
    try {
      valueSet = await vsacClient.expandValueSet(oid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ oid, label, status: 'failed', error: message });
      continue;
    }

    const fhirValueSet = {
      resourceType: 'ValueSet',
      url: `http://cts.nlm.nih.gov/fhir/ValueSet/${valueSet.oid}`,
      version: valueSet.version || '1.0.0',
      name: label,
      status: 'active',
      expansion: {
        contains: valueSet.concepts.map((c: Concept) => ({
          system: c.codeSystem,
          code: c.code,
          display: c.displayName,
        })),
      },
    };

    try {
      const vkasRes = await fetch(`${vkasBaseUrl}/v1/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_url: `http://cts.nlm.nih.gov/fhir/ValueSet/${oid}`,
          version: valueSet.version || '1.0.0',
          artifact_type: 'value_set',
          tenant_id: 'shared',
          content: fhirValueSet,
          created_by: 'vsac-sync',
        }),
      });

      if (vkasRes.status >= 200 && vkasRes.status < 300) {
        results.push({ oid, label, status: 'synced' });
      } else {
        results.push({ oid, label, status: 'failed', error: `VKAS upsert failed: ${vkasRes.status}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ oid, label, status: 'failed', error: `VKAS upsert failed: ${message}` });
    }
  }

  const synced = results.filter(r => r.status === 'synced').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = PA_VALUE_SET_OIDS.length - synced - failed;

  return res.json({ synced, failed, skipped, results });
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = parseInt(process.env['PORT'] ?? '3051', 10);
  app.listen(port, () => {
    console.log(`[vsac-proxy] Listening on port ${port}`);
  });
}
