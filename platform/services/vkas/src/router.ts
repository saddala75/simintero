import { Router, type Request, type Response } from "express";
import { resolveEffectiveVersion, type ArtifactRow } from "./resolve.js";
import { transitionStatus, StatusTransitionError } from "./lifecycle.js";

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

  return router;
}
