import express from 'express';
import type { Express, Request, Response } from 'express';
import { CqlCompilerClient } from './compiler/CqlCompilerClient.js';
import { TerminologyBindingValidator } from './terminology/TerminologyBindingValidator.js';
import { DraftArtifactCreator } from './vkas/DraftArtifactCreator.js';
import { createCompileRouter } from './routes/compile.js';
import { createValidateRouter } from './routes/validate.js';
import { createUnitTestRouter } from './routes/unitTest.js';
import { createDraftRouter } from './routes/draft.js';

// Re-export public types
export type { ElmResult, CompilerHttpClient } from './compiler/CqlCompilerClient.js';
export { CompilationError } from './compiler/CqlCompilerClient.js';
export type { ValidationResult, TerminologyHttpClient } from './terminology/TerminologyBindingValidator.js';
export type {
  DraftArtifactInput,
  DraftResult,
  VkasHttpClient,
} from './vkas/DraftArtifactCreator.js';
export type { TestCase, TestResult, ExpectedOutcome } from './routes/unitTest.js';
export { evaluateEvidence } from './routes/unitTest.js';

// Minimal fetch-based HTTP clients for production use
const fetchCompilerClient = {
  post: async (url: string, body: unknown): Promise<unknown> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<unknown>;
  },
};

const fetchTerminologyClient = {
  get: async (url: string): Promise<{ status: number }> => {
    const res = await fetch(url);
    return { status: res.status };
  },
};

const fetchVkasClient = {
  post: async (
    url: string,
    body: unknown
  ): Promise<{ artifact_id: string; version: string }> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ artifact_id: string; version: string }>;
  },
};

const runtimeBaseUrl =
  process.env['RUNTIME_BASE_URL'] ?? 'http://localhost:3020';
const terminologyGwBaseUrl =
  process.env['TERMINOLOGY_GW_BASE_URL'] ?? 'http://localhost:3030';
const vkasBaseUrl = process.env['VKAS_BASE_URL'] ?? 'http://localhost:3040';

const compiler = new CqlCompilerClient(fetchCompilerClient, runtimeBaseUrl);
const validator = new TerminologyBindingValidator(
  fetchTerminologyClient,
  terminologyGwBaseUrl
);
const draftCreator = new DraftArtifactCreator(fetchVkasClient, vkasBaseUrl);

const app: Express = express();
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-authoring' });
});

app.use(createCompileRouter(compiler));
app.use(createValidateRouter(validator));
app.use(createUnitTestRouter());
app.use(createDraftRouter(draftCreator));

export default app;

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3011);
  app.listen(port, () => {
    console.log(`[digicore-authoring] listening on :${port}`);
  });
}
