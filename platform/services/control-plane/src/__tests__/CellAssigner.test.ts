import { describe, it, expect, vi } from "vitest";
import { CellAssigner } from "../provisioning/CellAssigner.js";
import type { CtrlDb, CtrlClient } from "../db/index.js";

/** Build a mock CtrlDb whose transaction runs fn synchronously with a mock client. */
function makeMockDb(queryResponses: Array<{ rows: Record<string, unknown>[] }>) {
  const mockQuery = vi.fn();
  for (const resp of queryResponses) {
    mockQuery.mockResolvedValueOnce(resp);
  }
  const client: CtrlClient = { query: mockQuery as CtrlClient["query"] };
  const db: CtrlDb = {
    transaction: <T>(fn: (c: CtrlClient) => Promise<T>) => fn(client),
    query: vi.fn(),
  };
  return { db, mockQuery };
}

describe("CellAssigner", () => {
  it("selects the least-loaded cell (ORDER BY tenant count ASC)", async () => {
    // Given: the DB returns the less-loaded cell first (ordered by COUNT subquery ASC).
    const { db, mockQuery } = makeMockDb([
      { rows: [] },                                   // pg_advisory_xact_lock
      { rows: [{ cell_id: "cell-pooled-us1" }] },     // SELECT → least loaded
    ]);

    const assigner = new CellAssigner(db);
    const cellId = await assigner.assignCell("pooled", "us-east-1");

    expect(cellId).toBe("cell-pooled-us1");

    // Verify the SELECT uses capacity_max and orders by tenant count
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("capacity_max"),
      ["pooled", "us-east-1"],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("ORDER BY"),
      ["pooled", "us-east-1"],
    );
  });

  it("throws SIM-PLAT-NOCELL when all cells are at max capacity", async () => {
    const { db } = makeMockDb([
      { rows: [] }, // pg_advisory_xact_lock
      { rows: [] }, // SELECT returns no eligible cells
    ]);

    const assigner = new CellAssigner(db);

    await expect(assigner.assignCell("pooled", "us-east-1")).rejects.toMatchObject({
      code: "SIM-PLAT-NOCELL",
      status: 400,
    });
  });
});
