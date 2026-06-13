import { Router } from 'express';
import type { Request, Response } from 'express';
import { CqlCompilerClient, CompilationError } from '../compiler/CqlCompilerClient.js';

export function createCompileRouter(compiler: CqlCompilerClient): Router {
  const router = Router();

  router.post('/v1/authoring/compile', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const cql = body['cql'];

    if (typeof cql !== 'string' || cql.trim() === '') {
      res.status(400).json({ error: 'cql is required and must be a non-empty string' });
      return;
    }

    try {
      const elm = await compiler.compile(cql);
      res.status(200).json({ elm });
    } catch (err) {
      if (err instanceof CompilationError) {
        res.status(400).json({ error: 'Compilation failed', details: err.errors });
        return;
      }
      res.status(500).json({ error: 'Compilation service error' });
    }
  });

  return router;
}
