import { describe, it, expect, vi } from "vitest";
import { relayBatch } from "./relay.js";

describe("relayBatch", () => {
  it("returns 0 and does not call kafka for empty batch", async () => {
    const kafka = { send: vi.fn() };
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })  // SELECT returns empty
    };
    const db = { transaction: (fn: any) => fn(mockClient) };

    const count = await relayBatch(db as any, kafka as any);

    expect(count).toBe(0);
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it("publishes and marks each row in a batch", async () => {
    const kafka = { send: vi.fn().mockResolvedValue(undefined) };
    const rows = [
      { seq: "1", topic: "sim.case.lifecycle", key: "case_01", envelope: '{"event_id":"evt_01"}' },
      { seq: "2", topic: "sim.artifact", key: "art_01", envelope: '{"event_id":"evt_02"}' },
    ];
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows })    // SELECT
        .mockResolvedValue({ rows: [] })    // UPDATE (for each row)
    };
    const db = { transaction: (fn: any) => fn(mockClient) };

    const count = await relayBatch(db as any, kafka as any);

    expect(count).toBe(2);
    expect(kafka.send).toHaveBeenCalledTimes(2);
    expect(kafka.send).toHaveBeenNthCalledWith(1, "sim.case.lifecycle", "case_01", '{"event_id":"evt_01"}');
    expect(kafka.send).toHaveBeenNthCalledWith(2, "sim.artifact", "art_01", '{"event_id":"evt_02"}');
    // UPDATE called once per row (filter out the SELECT which also contains "FOR UPDATE SKIP LOCKED")
    const updateCalls = mockClient.query.mock.calls.filter((c: string[]) => (c[0] ?? "").trimStart().startsWith("UPDATE"));
    expect(updateCalls).toHaveLength(2);
  });

  it("rolls back all marks when kafka.send throws (at-least-once re-delivery)", async () => {
    const kafka = {
      send: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Kafka unavailable"))
    };
    const rows = [
      { seq: "1", topic: "sim.case.lifecycle", key: "k1", envelope: "{}" },
      { seq: "2", topic: "sim.artifact", key: "k2", envelope: "{}" },
    ];
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows })
        .mockResolvedValue({ rows: [] })
    };
    const db = {
      transaction: async (fn: any) => {
        try { return await fn(mockClient); }
        catch (err) {
          // simulate ROLLBACK on error — UPDATEs already issued but now rolled back
          throw err;
        }
      }
    };

    await expect(relayBatch(db as any, kafka as any)).rejects.toThrow("Kafka unavailable");
    // Kafka was called twice (first succeeded, second failed)
    expect(kafka.send).toHaveBeenCalledTimes(2);
  });
});
