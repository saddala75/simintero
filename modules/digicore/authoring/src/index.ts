import '@sim/otel'
import { enrichSpan } from '@sim/otel'
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { CqlCompilerClient } from './compiler/CqlCompilerClient.js';
import { TerminologyBindingValidator } from './terminology/TerminologyBindingValidator.js';
import { DraftArtifactCreator } from './vkas/DraftArtifactCreator.js';
import { createCompileRouter } from './routes/compile.js';
import { createValidateRouter } from './routes/validate.js';
import { createUnitTestRouter } from './routes/unitTest.js';
import { createDraftRouter } from './routes/draft.js';
import { createRulesRouter } from './routes/rules.js';
import { requireAuth, createJwksVerifier } from './middleware/requireAuth.js';
import type {
  RulesCompiler,
  RulesVkasClient,
  RulesGovernanceClient,
} from './routes/rules.js';

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
export { createRulesRouter } from './routes/rules.js';
export type {
  RulesCompiler,
  RulesVkasClient,
  RulesGovernanceClient,
  RulesRouterDeps,
} from './routes/rules.js';

// Minimal fetch-based HTTP clients for production use
const fetchCompilerClient = {
  post: async (url: string, body: unknown): Promise<unknown> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${url} failed (${res.status}): ${text.slice(0, 200)}`);
    }
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${url} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<{ artifact_id: string; version: string }>;
  },
};

const fetchGovernanceClient = {
  post: async (url: string, body: unknown, authHeader?: string): Promise<unknown> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${url} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<unknown>;
  },
};

const runtimeBaseUrl =
  process.env['RUNTIME_BASE_URL'] ?? 'http://localhost:3020';
const terminologyGwBaseUrl =
  process.env['TERMINOLOGY_GW_BASE_URL'] ?? 'http://localhost:3030';
const vkasBaseUrl = process.env['VKAS_BASE_URL'] ?? 'http://localhost:3040';
const governanceBaseUrl =
  process.env['GOVERNANCE_BASE_URL'] ?? 'http://localhost:3014';

const compiler = new CqlCompilerClient(fetchCompilerClient, runtimeBaseUrl);
const validator = new TerminologyBindingValidator(
  fetchTerminologyClient,
  terminologyGwBaseUrl
);
const draftCreator = new DraftArtifactCreator(fetchVkasClient, vkasBaseUrl);

// Orchestrator deps (POST /v1/authoring/rules)
const rulesCompiler: RulesCompiler = {
  compile: (cql: string) => compiler.compile(cql),
};

const rulesVkas: RulesVkasClient = {
  create: (input) => fetchVkasClient.post(`${vkasBaseUrl}/v1/artifacts`, input),
  submit: (canonical_url, version) =>
    fetchVkasClient.post(`${vkasBaseUrl}/v1/artifacts/submit`, {
      canonical_url,
      version,
    }),
};

const rulesGovernance: RulesGovernanceClient = {
  enqueue: (body, authHeader) =>
    fetchGovernanceClient.post(
      `${governanceBaseUrl}/v1/governance/queue/submit`,
      body,
      authHeader,
    ),
};

const jwksVerifier = createJwksVerifier();
const auth = requireAuth(jwksVerifier);

const app: Express = express();
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  const tenantId = (req as any).tenantId ?? (req.headers['x-tenant-id'] as string | undefined)
  const sub = (req as any).sub as string | undefined
  if (tenantId) enrichSpan({ tenant_id: tenantId })
  if (sub) enrichSpan({ 'user.sub': sub })
  next()
})

// Health check — no auth required
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'digicore-authoring' });
});

// All mutation routes require a valid Keycloak Bearer JWT.
// The verified sub claim is injected as req.user.sub for downstream handlers.
app.use(auth);
app.use(createCompileRouter(compiler));
app.use(createValidateRouter(validator));
app.use(createUnitTestRouter());
app.use(createDraftRouter(draftCreator));
app.use(
  createRulesRouter({
    compiler: rulesCompiler,
    vkas: rulesVkas,
    governance: rulesGovernance,
  })
);

export default app;

if (process.env['NODE_ENV'] !== 'test') {
  const port = Number(process.env['PORT'] ?? 3011);
  app.listen(port, () => {
    console.log(`[digicore-authoring] listening on :${port}`);
  });
}
