import express, { type Express } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createArtifactsRouter } from './routes/artifacts.js';
import { createArtifactDetailRouter } from './routes/artifactDetail.js';
import { ArtifactSearchService } from './search/ArtifactSearchService.js';
import type { OSClient } from './search/ArtifactSearchService.js';
import type { TenantDb } from '@sim/outbox-ts';

export { ArtifactSearchService } from './search/ArtifactSearchService.js';
export type {
  OSClient,
  OSSearchQuery,
  OSSearchResult,
  ArtifactQuery,
  ArtifactSummary,
} from './search/ArtifactSearchService.js';
export { OpenSearchIndexer } from './search/OpenSearchIndexer.js';
export type {
  OSIndexClient,
  ArtifactDocument,
} from './search/OpenSearchIndexer.js';
export { ArtifactCacheInvalidator } from './invalidation/ArtifactCacheInvalidator.js';
export type { ArtifactActivatedPayload } from './invalidation/ArtifactCacheInvalidator.js';

const app: Express = express();
app.use(express.json());

// Dependency injection: callers set these before starting
let tenantDb: TenantDb | null = null;
let osClient: OSClient | null = null;

export function setDb(db: TenantDb): void {
  tenantDb = db;
}

export function setOsClient(client: OSClient): void {
  osClient = client;
}

function requireDeps(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!tenantDb || !osClient) {
    res.status(503).json({ error: 'Service not initialised' });
    return;
  }
  next();
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-registry' });
});

// Faceted search: GET /v1/registry/artifacts
app.get(
  '/v1/registry/artifacts',
  requireDeps,
  (req: Request, res: Response, next: NextFunction) => {
    // osClient is guaranteed non-null here because requireDeps passed
    const searchService = new ArtifactSearchService(osClient!);
    createArtifactsRouter(searchService)(req, res, next);
  }
);

// Artifact detail: GET /v1/registry/artifacts/:canonical/:version
app.use(
  '/v1/registry/artifacts/:canonical/:version',
  requireDeps,
  (req: Request, res: Response, next: NextFunction) => {
    createArtifactDetailRouter(tenantDb!)(req, res, next);
  }
);

export default app;

// Standalone start when invoked directly
if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3010);
  app.listen(port, () => {
    console.log(`[digicore-registry] listening on :${port}`);
  });
}
