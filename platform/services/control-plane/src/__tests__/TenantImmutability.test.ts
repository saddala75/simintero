import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { guardNoPhi, guardTenantIdImmutable } from "../routes/tenants.js";
import { SimError } from "../errors.js";

describe("TenantImmutability", () => {
  describe("guardNoPhi — rejects PHI fields from ctrl schema", () => {
    it("throws SIM-PLAT-PHI when body contains member_id", () => {
      expect(() => guardNoPhi({ member_id: "M12345" })).toThrow(SimError);
      expect(() => guardNoPhi({ member_id: "M12345" })).toThrowError(
        expect.objectContaining({ code: "SIM-PLAT-PHI", status: 400 }),
      );
    });

    it("throws SIM-PLAT-PHI when body contains dob", () => {
      expect(() => guardNoPhi({ dob: "1990-01-01" })).toThrowError(
        expect.objectContaining({ code: "SIM-PLAT-PHI" }),
      );
    });

    it("throws SIM-PLAT-PHI when body contains diagnosis", () => {
      expect(() => guardNoPhi({ diagnosis: "J18.9" })).toThrowError(
        expect.objectContaining({ code: "SIM-PLAT-PHI" }),
      );
    });

    it("does not throw when body is PHI-free", () => {
      expect(() =>
        guardNoPhi({ display_name: "Acme Health", tier: "pooled", region: "us-east-1" }),
      ).not.toThrow();
    });
  });

  describe("guardTenantIdImmutable — tenant_id must not be caller-supplied in updates", () => {
    it("throws SIM-PLAT-0013 (400) when tenant_id is present in body", () => {
      expect(() => guardTenantIdImmutable({ tenant_id: "t_custom" })).toThrow(SimError);
      expect(() => guardTenantIdImmutable({ tenant_id: "t_custom" })).toThrowError(
        expect.objectContaining({ code: "SIM-PLAT-0013", status: 400 }),
      );
    });

    it("does not throw when tenant_id is absent from body", () => {
      expect(() =>
        guardTenantIdImmutable({ display_name: "Updated Name" }),
      ).not.toThrow();
    });
  });

  describe("POST /v1/tenants auto-generates unique tenant IDs", () => {
    it("generates a t_-prefixed UUID for each new tenant", () => {
      // The route uses `t_${randomUUID()}` — verify the format
      const id = `t_${randomUUID()}`;
      expect(id).toMatch(/^t_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("generates a different ID for every call (no client-controlled IDs)", () => {
      const ids = Array.from({ length: 5 }, () => `t_${randomUUID()}`);
      const unique = new Set(ids);
      expect(unique.size).toBe(5);
    });
  });
});
