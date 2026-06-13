import { SimError } from "../errors.js";

/**
 * Guards that enforce tenant lifecycle invariants at the service layer.
 * These are intentionally lightweight — heavy state-machine logic lives in the DB layer.
 */
export class TenantLifecycle {
  /**
   * Throws SIM-PLAT-0015 (409) if the tenant has been decommissioned.
   * All mutating operations must call this first.
   */
  guardNotDecommissioned(status: string): void {
    if (status === "decommissioned") {
      throw new SimError(
        "SIM-PLAT-0015",
        409,
        "Operation rejected: tenant is decommissioned",
      );
    }
  }

  /**
   * Throws SIM-PLAT-0020 (403) if the tenant tier is 'enclave'.
   * Enclave tenants may never be impersonated by support staff.
   */
  guardNotEnclave(tier: string): void {
    if (tier === "enclave") {
      throw new SimError(
        "SIM-PLAT-0020",
        403,
        "Impersonation is not permitted for enclave-tier tenants",
      );
    }
  }
}
