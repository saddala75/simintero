import { Router, type Request, type Response } from "express";
import type { OperationTracker } from "../provisioning/OperationTracker.js";

export function createOperationsRouter(tracker: OperationTracker): Router {
  const router = Router();

  // GET /v1/operations/:id
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params["id"];
      if (!id) {
        res.status(400).json({ code: "SIM-PLAT-0010", error: "Missing operation id" });
        return;
      }

      const op = await tracker.get(id);
      if (!op) {
        res.status(404).json({ code: "SIM-PLAT-0030", error: "Operation not found" });
        return;
      }
      res.json(op);
    } catch {
      res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
    }
  });

  return router;
}
