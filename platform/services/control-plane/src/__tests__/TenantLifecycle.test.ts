import { describe, it, expect } from "vitest";
import { TenantLifecycle } from "../lifecycle/TenantLifecycle.js";
import { SimError } from "../errors.js";

describe("TenantLifecycle", () => {
  const lifecycle = new TenantLifecycle();

  describe("guardNotDecommissioned", () => {
    it("throws SIM-PLAT-0015 with status 409 for decommissioned tenant", () => {
      expect(() => lifecycle.guardNotDecommissioned("decommissioned")).toThrow(SimError);
      try {
        lifecycle.guardNotDecommissioned("decommissioned");
      } catch (err) {
        expect(err).toBeInstanceOf(SimError);
        expect((err as SimError).code).toBe("SIM-PLAT-0015");
        expect((err as SimError).status).toBe(409);
      }
    });

    it("does not throw for status=active", () => {
      expect(() => lifecycle.guardNotDecommissioned("active")).not.toThrow();
    });

    it("does not throw for status=suspended", () => {
      expect(() => lifecycle.guardNotDecommissioned("suspended")).not.toThrow();
    });

    it("does not throw for status=provisioning", () => {
      expect(() => lifecycle.guardNotDecommissioned("provisioning")).not.toThrow();
    });
  });

  describe("guardNotEnclave", () => {
    it("throws SIM-PLAT-0020 with status 403 for enclave tier", () => {
      expect(() => lifecycle.guardNotEnclave("enclave")).toThrow(SimError);
      try {
        lifecycle.guardNotEnclave("enclave");
      } catch (err) {
        expect(err).toBeInstanceOf(SimError);
        expect((err as SimError).code).toBe("SIM-PLAT-0020");
        expect((err as SimError).status).toBe(403);
      }
    });

    it("does not throw for tier=pooled", () => {
      expect(() => lifecycle.guardNotEnclave("pooled")).not.toThrow();
    });

    it("does not throw for tier=dedicated", () => {
      expect(() => lifecycle.guardNotEnclave("dedicated")).not.toThrow();
    });
  });
});
