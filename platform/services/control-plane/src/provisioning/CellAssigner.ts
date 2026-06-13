import { SimError } from "../errors.js";
import type { CtrlDb } from "../db/index.js";

interface CellRow {
  cell_id: string;
}

/**
 * Assigns a tenant to the least-loaded cell matching the requested tier and region.
 * Uses pg_advisory_xact_lock to prevent concurrent double-assignment.
 */
export class CellAssigner {
  constructor(private readonly db: CtrlDb) {}

  async assignCell(
    tier: "pooled" | "dedicated" | "enclave",
    region: string,
  ): Promise<string> {
    return this.db.transaction(async (client) => {
      // Serialise cell assignment within this region+tier
      await client.query("SELECT pg_advisory_xact_lock(42)");

      const result = await client.query<CellRow>(
        `SELECT c.cell_id
           FROM ctrl.cell c
          WHERE c.tier = $1
            AND c.region = $2
            AND c.status = 'active'
            AND (
              SELECT COUNT(*) FROM ctrl.tenant t
               WHERE t.cell_id = c.cell_id
                 AND t.status NOT IN ('archived','decommissioned')
            ) < c.capacity_max
          ORDER BY (
            SELECT COUNT(*) FROM ctrl.tenant t
             WHERE t.cell_id = c.cell_id
               AND t.status NOT IN ('archived','decommissioned')
          ) ASC
          LIMIT 1`,
        [tier, region],
      );

      const cell = result.rows[0];
      if (!cell) {
        throw new SimError(
          "SIM-PLAT-NOCELL",
          400,
          `No available cell for tier=${tier} region=${region}`,
        );
      }

      return cell.cell_id;
    });
  }
}
