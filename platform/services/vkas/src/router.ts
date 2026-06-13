import { Router, type Request, type Response, type NextFunction } from "express";
import { resolveEffectiveVersion, type ArtifactRow } from "./resolve.js";
import { transitionStatus, StatusTransitionError } from "./lifecycle.js";
import { evaluateBlastRadius, applyPromotion, type PromotionSet } from "./promotions.js";

export function createVkasRouter(): Router {
  const router = Router();

  // POST /v1/artifacts — create draft artifact
  router.post("/v1/artifacts", async (_req: Request, res: Response) => {
    // Phase 0: stub — full DB integration in Phase 1
    res.status(501).json({ error: "Not implemented in Phase 0 stub" });
  });

  // Express route for Google custom-method pattern GET /v1/artifacts:resolve
  // The regex ensures ':resolve' is matched literally, not as a param capture.
  router.get(/^\/v1\/artifacts:resolve$/, async (req: Request, res: Response) => {
    const { canonical_url } = req.query as Record<string, string>;
    if (!canonical_url) {
      res.status(400).json({ error: "canonical_url is required" });
      return;
    }

    // Phase 0: resolution algorithm implemented; DB integration in Phase 1
    // Return 501 until the DB layer is wired
    res.status(501).json({ error: "Not implemented in Phase 0 stub" });
    return;
  });

  // POST /v1/artifacts/:canonicalUrl/:version/submit
  router.post("/v1/artifacts/:canonicalUrl/:version/submit", async (_req: Request, res: Response) => {
    try {
      transitionStatus("draft", "in_review");
      res.status(501).json({ error: "Not implemented in Phase 0 stub" });
    } catch (err) {
      if (err instanceof StatusTransitionError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // POST /v1/promotions — promote artifacts through blast-radius gate
  router.post('/v1/promotions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const set = req.body as PromotionSet;
      const pool = req.app.locals['pool'];

      const blastResult = await evaluateBlastRadius(set, pool);
      if (!blastResult.passed) {
        res.status(422).json({
          type: 'https://errors.simintero.io/SIM-VKAS-BLAST_RADIUS',
          code: 'SIM-VKAS-BLAST_RADIUS',
          detail: 'Promotion blocked by blast-radius gate',
          items: blastResult.items.filter(i => !i.passed),
        });
        return;
      }

      const diff = await applyPromotion(set, pool);
      res.status(201).json({ status: 'promoted', diff });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
