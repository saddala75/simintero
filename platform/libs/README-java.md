# Java conformance libs

Java implementations of the platform conformance contract (`contracts/conformance/README.md`)
for the `interop` FHIR-edge service:

- **simintero-tenant-context** (`tenant-context/java`) — protocol 1: the `x-sim-ctx`
  servlet `TenantContextFilter` (401 codes SIM-PLAT-0001/0002/0003) + `TenantConnections.setTenantGuc`
  (transaction-local `set_config('sim.tenant_id', ?, true)`).
- **simintero-authz** (`authz-client/java`) — protocol 3 *decision* layer: `OpaAuthorizer`
  (POST `/v1/data/sim/guards/adverse_action/allow`, `principal.sim`, `SIM-AUTHZ-0001`/403).

Not provided in Java (by design):
- **Identity (JWT) validation** — `interop` uses Spring Security resource server to validate the
  Keycloak realm-`simintero` JWT; the principal claims feed `OpaAuthorizer`. (The Python lib bundles
  a JWT validator only because workflow-engine is FastAPI.)
- **Outbox** — deferred (YAGNI) until `interop` publishes domain events directly (Section C).
- **x-sim-ctx minting/signature verification** — the `TenantContextFilter` takes a pluggable
  `Verifier`; the minting authority is a Section C decision.

Build: `mvn -f platform/libs/<name>/java/pom.xml test`. Targets Java 17 (consumable by the
Java-21 `interop` service). RLS tests use testcontainers (Docker required) and connect as a
NON-SUPERUSER role (superusers bypass RLS).
