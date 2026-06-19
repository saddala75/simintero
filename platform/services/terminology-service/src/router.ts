import { Router, type Request, type Response } from 'express';
import { resolveValueSet } from './vkas.js';
import { validateCode } from './validateCode.js';
import { expand } from './expand.js';

function operationOutcome(diagnostics: string) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'not-found', diagnostics }],
  };
}

export function createTerminologyRouter(vkasBaseUrl: string): Router {
  const router = Router();

  // GET /fhir/ValueSet/$validate-code?url=&system=&code=&display=
  router.get(/^\/fhir\/ValueSet\/\$validate-code$/, async (req: Request, res: Response) => {
    const { url, system, code } = req.query as Record<string, string | undefined>;
    if (!url) {
      res.status(400).json(operationOutcome('url query parameter is required'));
      return;
    }
    const vs = await resolveValueSet(vkasBaseUrl, url);
    const outcome = validateCode(vs, system, code);
    if (!outcome.resolved) {
      res.status(404).json(operationOutcome(`value-set not found: ${url}`));
      return;
    }
    const parameter: Array<Record<string, unknown>> = [
      { name: 'result', valueBoolean: outcome.result },
    ];
    if (outcome.display) {
      parameter.push({ name: 'display', valueString: outcome.display });
    }
    res.status(200).json({ resourceType: 'Parameters', parameter });
  });

  // GET /fhir/ValueSet/$expand?url=
  router.get(/^\/fhir\/ValueSet\/\$expand$/, async (req: Request, res: Response) => {
    const { url } = req.query as Record<string, string | undefined>;
    if (!url) {
      res.status(400).json(operationOutcome('url query parameter is required'));
      return;
    }
    const vs = expand(await resolveValueSet(vkasBaseUrl, url));
    if (vs === null) {
      res.status(404).json(operationOutcome(`value-set not found: ${url}`));
      return;
    }
    res.status(200).json(vs);
  });

  return router;
}
