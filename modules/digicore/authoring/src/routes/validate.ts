import { Router } from 'express';
import type { Request, Response } from 'express';
import { TerminologyBindingValidator } from '../terminology/TerminologyBindingValidator.js';

export function createValidateRouter(validator: TerminologyBindingValidator): Router {
  const router = Router();

  router.post('/v1/authoring/validate', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const cql = body['cql'];

    if (typeof cql !== 'string' || cql.trim() === '') {
      res.status(400).json({ error: 'cql is required and must be a non-empty string' });
      return;
    }

    try {
      const result = await validator.validate(cql);
      res.status(200).json(result);
    } catch {
      res.status(500).json({ error: 'Terminology validation service error' });
    }
  });

  return router;
}
