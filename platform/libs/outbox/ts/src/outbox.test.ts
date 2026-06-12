import { describe, it, expect, vi } from "vitest";
import { createOutbox } from "./index.js";

describe("Outbox", () => {
  it("appends event and marks tenant_id from context", async () => {
    const mockInsert = vi.fn().mockResolvedValue(undefined);
    const db = { transaction: (fn: any) => fn({ query: mockInsert }) };
    const outbox = createOutbox(db as any);

    await outbox.append({
      event_id: "evt_01JTEST01",
      schema_ref: "sim.case.created/v1",
      occurred_at: "2026-06-10T00:00:00Z",
      tenant: { tenant_id: "t_test" },
      correlation_id: "case_01JTEST",
      causation_id: null,
      actor: { type: "service", id: "intake-svc" },
      trace_ref: null,
      payload: { case_id: "case_01JTEST" },
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO shared.outbox"),
      expect.arrayContaining(["evt_01JTEST01"])
    );
  });

  it("is idempotent on duplicate event_id", async () => {
    const mockInsert = vi.fn().mockResolvedValue(undefined);
    const db = { transaction: (fn: any) => fn({ query: mockInsert }) };
    const outbox = createOutbox(db as any);
    const envelope = {
      event_id: "evt_DUPLICATE",
      schema_ref: "sim.case.created/v1",
      occurred_at: "2026-06-10T00:00:00Z",
      tenant: { tenant_id: "t_test" },
      correlation_id: "case_01J",
      causation_id: null,
      actor: { type: "service" as const, id: "svc" },
      trace_ref: null,
      payload: {},
    };

    await outbox.append(envelope);
    await outbox.append(envelope); // second call — must not throw

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls[1]?.[0]).toContain("ON CONFLICT (event_id) DO NOTHING");
  });

  it("topicFor routes known schema_ref prefixes", async () => {
    // Test via outbox.append calls with different schema_refs
    const queries: string[][] = [];
    const db = {
      transaction: (fn: any) => fn({
        query: (sql: string, params: string[]) => {
          queries.push(params);
          return Promise.resolve(undefined);
        }
      })
    };
    const outbox = createOutbox(db as any);

    const cases: Array<[string, string]> = [
      ["sim.case.created/v1", "sim.case.lifecycle"],
      ["sim.evidence.added/v1", "sim.evidence"],
      ["sim.artifact.activated/v1", "sim.artifact"],
      ["sim.ai.interaction.recorded/v1", "sim.ai.interaction"],
      ["sim.clock.breach/v1", "sim.clock"],
      ["sim.tenant.provisioned/v1", "sim.tenant.admin"],
    ];

    for (const [schemaRef, expectedTopic] of cases) {
      queries.length = 0;
      await outbox.append({
        event_id: `evt_${schemaRef}`,
        schema_ref: schemaRef,
        occurred_at: "2026-06-10T00:00:00Z",
        tenant: { tenant_id: "t_test" },
        correlation_id: "c",
        causation_id: null,
        actor: { type: "service" as const, id: "svc" },
        trace_ref: null,
        payload: {},
      });
      // topic is the second parameter ($2)
      expect(queries[0]?.[1]).toBe(expectedTopic);
    }
  });

  it("throws on unknown schema_ref prefix", async () => {
    const db = { transaction: vi.fn() };
    const outbox = createOutbox(db as any);

    await expect(outbox.append({
      event_id: "evt_unknown",
      schema_ref: "unknown.topic/v1",
      occurred_at: "2026-06-10T00:00:00Z",
      tenant: { tenant_id: "t_test" },
      correlation_id: "c",
      causation_id: null,
      actor: { type: "service" as const, id: "svc" },
      trace_ref: null,
      payload: {},
    })).rejects.toThrow("Unknown schema_ref prefix");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
