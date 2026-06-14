# Platform conformance contract

A service conforms to the Simintero platform by satisfying these three protocols
in its own language. Reference TS implementations: `platform/libs/{tenant-context,outbox,authz-client}/ts`.

## 1. Tenant-context protocol
- Every authenticated request carries a signed `x-sim-ctx` token. Verify it → produce a
  `TenantContext{ tenant_id, cell_id, tier(pooled|dedicated|enclave),
  scopes{lob[],region[],modules[]}, roles[], principal_type(human|service|model_agent) }`.
  Reject missing/invalid context with 401 codes `SIM-PLAT-0001` (missing header),
  `SIM-PLAT-0002` (missing tenant_id), `SIM-PLAT-0003` (verify failed).
- Open every DB transaction with **transaction-local** GUC: `SELECT set_config('sim.tenant_id', <tenant_id>, true)`
  inside `BEGIN ... COMMIT`. Never session-level. RLS `tenant_isolation` does the filtering.

## 2. Outbox protocol
- Write domain state + a `shared.outbox` row in ONE transaction. Columns:
  `shared.outbox(event_id, topic, key, envelope jsonb, tenant_id)`; insert
  `ON CONFLICT (event_id) DO NOTHING`. The whole envelope is stored as one jsonb column.
- The envelope is the `EventEnvelope` from `simintero-contracts`.
- Topic routing by `schema_ref` prefix: `sim.case.`→`sim.case.lifecycle`, `sim.evidence.`→`sim.evidence`,
  `sim.artifact.`→`sim.artifact`, `sim.ai.`→`sim.ai.interaction`, `sim.clock.`→`sim.clock`,
  `sim.tenant.`→`sim.tenant.admin`; unknown prefix is an error.
- A relay polls unpublished rows `FOR UPDATE SKIP LOCKED`, publishes to Kafka, marks published.
- Consumers dedup on `event_id` (`shared.processed_events`).

## 3. Authz protocol
- **Identity:** validate the Keycloak JWT (RS256/JWKS) against realm `simintero`, enforcing
  issuer AND audience (reject a token missing `aud`).
- **Decision:** for policy outcomes (esp. adverse determinations), POST to
  `${OPA_URL}/v1/data/sim/guards/adverse_action/allow` with
  `{ input: { action, resource, principal: { sim: { tenant_id, roles, principal_type } } } }`;
  deny on `result !== true` with error `SIM-AUTHZ-0001` / HTTP 403.

## Conformance is proven by the conformance test kit (`platform/conformance-kit/`):
RLS leak probe (zero cross-tenant reads), envelope validation (every emitted event validates
against the published envelope), and guard non-bypass (no adverse path skips the OPA decision).
