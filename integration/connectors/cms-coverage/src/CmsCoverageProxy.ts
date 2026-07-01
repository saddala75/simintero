import express from 'express';
import { CmsCoverageClient } from './CmsCoverageClient.js';
import { ingestNcds } from './NcdIngester.js';

const cmsBaseUrl = process.env['CMS_COVERAGE_BASE_URL'] ?? '';
const vkasBaseUrl = process.env['VKAS_BASE_URL'] ?? 'http://vkas:3040';

const cmsClient = new CmsCoverageClient(cmsBaseUrl);

export const app = express();
app.use(express.json());

app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

app.post('/ncd/sync', async (_req, res) => {
  let ncds;
  try {
    ncds = await cmsClient.fetchNcds();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: message });
  }
  const results = await ingestNcds(ncds, vkasBaseUrl);
  const synced = results.reduce((s, r) => s + r.synced, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0);
  return res.json({ synced, failed, skipped: 0, results });
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = parseInt(process.env['PORT'] ?? '3055', 10);
  app.listen(port, () => console.log(`[cms-coverage-proxy] Listening on port ${port}`));
}
