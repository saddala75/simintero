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

  // GET /v1/artifacts:resolve — resolve effective version
  router.get("/v1/artifacts:resolve", async (req: Request, res: Response) => {
    const { canonical_url, as_of, lob, region } = req.query as Record<string, string>;
    if (!canonical_url) {
      res.status(400).json({ error: "canonical_url is required" });
      return;
    }

    // Phase 0: stub — query resolved from DB in Phase 1
    const candidates: ArtifactRow[] = [];
    const result = resolveEffectiveVersion(candidates, {
      asOf: as_of ? new Date(as_of) : new Date(),
      ctx: {
        ...(lob !== undefined && { lob }),
        ...(region !== undefined && { region }),
      },
    });

    if (!result) {
      res.status(404).json({ error: "No effective version found" });
      return;
    }
    res.json(result);
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
