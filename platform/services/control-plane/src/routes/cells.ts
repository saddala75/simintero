import { Router, type Request, type Response } from "express";
import type { CtrlDb } from "../db/index.js";

interface CellRow {
  cell_id: string;
  region: string;
  tier: string;
  current_tenant_count: number;
  max_tenants: number;
}

export function createCellsRouter(db: CtrlDb): Router {
  const router = Router();

  // GET /v1/cells
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const rows = await db.query<CellRow>(
        "SELECT * FROM ctrl.cell ORDER BY region, tier",
      );
      res.json({ cells: rows });
    } catch {
      res.status(500).json({ code: "SIM-PLAT-9999", error: "Internal server error" });
    }
  });

  return router;
}
