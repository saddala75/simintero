import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.js';

const ARTIFACT_BASE = 'https://artifacts.simintero.io/shared/';
const VERSION = '1.0.0';

export interface RulesCompiler {
  compile(cql: string): Promise<unknown>;
}

export interface RulesVkasClient {
  create(input: Record<string, unknown>): Promise<{ artifact_id: string; version: string }>;
  submit(canonical_url: string, version: string): Promise<unknown>;
}

export interface RulesGovernanceClient {
  enqueue(body: Record<string, unknown>, authHeader: string): Promise<unknown>;
}

export interface RulesRouterDeps {
  compiler: RulesCompiler;
  vkas: RulesVkasClient;
  governance: RulesGovernanceClient;
}

// 'created_by' is intentionally absent — it is derived from the verified JWT sub claim.
const REQUIRED_FIELDS = ['procedure_code', 'slug', 'cql'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function createRulesRouter(deps: RulesRouterDeps): Router {
  const { compiler, vkas, governance } = deps;
  const router = Router();

  router.post('/v1/authoring/rules', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;

    for (const field of REQUIRED_FIELDS) {
      if (!isNonEmptyString(body[field])) {
        res.status(400).json({ error: `${field} is required and must be a non-empty string` });
        return;
      }
    }

    const procedureCode = body['procedure_code'] as string;
    const slug = body['slug'] as string;
    const cql = body['cql'] as string;
    // created_by comes from the verified JWT sub claim, never from the request body.
    const createdBy = (req as AuthedRequest).user.sub;
    const paRequired = body['pa_required'];
    const pins = body['pins'];
    const dtrPackageRef = body['dtr_package_ref'];
    const evidenceRequirements = body['evidence_requirements'];

    // 1. Compile CQL -> ELM
    let elm: unknown;
    try {
      elm = await compiler.compile(cql);
    } catch (err) {
      const errors =
        err && typeof err === 'object' && 'errors' in err
          ? (err as { errors: unknown }).errors
          : [err instanceof Error ? err.message : 'compilation failed'];
      res.status(400).json({ error: 'CQL compilation failed', errors });
      return;
    }

    const cqlLibraryUrl = `${ARTIFACT_BASE}cql_library/${slug}`;
    const coverageRuleUrl = `${ARTIFACT_BASE}coverage_rule/${procedureCode}`;

    const cqlLibraryArtifact: Record<string, unknown> = {
      canonical_url: cqlLibraryUrl,
      artifact_type: 'cql_library',
      content: { cql, elm },
      created_by: createdBy,
    };

    const coverageRuleArtifact: Record<string, unknown> = {
      canonical_url: coverageRuleUrl,
      artifact_type: 'coverage_rule',
      content: {
        procedure_codes: [procedureCode],
        pa_required: paRequired,
        pins,
        dtr_package_ref: dtrPackageRef,
        evidence_requirements: evidenceRequirements,
        elm_ref: cqlLibraryUrl,
        elm_version: VERSION,
      },
      created_by: createdBy,
    };

    try {
      // 2. Create both drafts in VKAS
      await vkas.create(cqlLibraryArtifact);
      await vkas.create(coverageRuleArtifact);

      // 3. Submit both
      await vkas.submit(cqlLibraryUrl, VERSION);
      await vkas.submit(coverageRuleUrl, VERSION);

      // 4. Enqueue in governance — forward the caller's Authorization header so the
      // governance service (now also JWT-protected) can validate the same token.
      await governance.enqueue(
        {
          artifact_id: coverageRuleUrl,
          cql_library_url: cqlLibraryUrl,
          version: VERSION,
          created_by: createdBy,
        },
        req.headers.authorization as string,
      );
    } catch (err) {
      res.status(502).json({
        error: 'Failed to orchestrate rule authoring downstream',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(201).json({
      rule_id: coverageRuleUrl,
      cql_library_url: cqlLibraryUrl,
      version: VERSION,
      status: 'in_review',
    });
  });

  return router;
}
