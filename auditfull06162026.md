# Where the platform & products actually stand — code-level audit (2026-06-16)

> Method: six parallel read-only code-level audits of `/Users/srikanthaddala/Downloads/Simintero/simintero`, each applying the maturity rubric **Exists → Builds → Runs → Proven** with file:line evidence. Findings cross-corroborate. This reflects the **built code**, not docs or memory.

**Rubric**
- **Exists** — code is in the repo
- **Builds** — produces a runnable image / compiles (for TS: Dockerfile uses `pnpm deploy` [self-contained] vs `COPY node_modules` [dangling pnpm symlinks → runtime crash-loop])
- **Runs** — is a service in `docker-compose.yml` with a healthcheck and a bootable entrypoint
- **Proven** — endpoints return real results (not 501/stub/hardcoded) and a test or smoke exercises it end-to-end

---

## The one-paragraph truth

You have a **strong front door and a sound spine, but a dead middle**. What genuinely runs end-to-end is the **FHIR prior-auth intake** (`Claim/$submit` → `ClaimResponse(queued)` → `$inquire`), the **document service**, the **reviewer portal-bff + auth**, and the **contracts/identity/RLS primitives**. But three *systemic* infrastructure defects mean almost nothing works **past intake**: (1) most TypeScript services **can't boot** (broken Dockerfiles / empty entrypoints), (2) the **event plane is dead** (the outbox is never drained to Kafka, so no workflow case is ever created and no consumer fires), and (3) there's **no Temporal worker** and the **VKAS artifact service doesn't exist as a service** (returns 501), which strands all AI inference and all coverage-rule authoring. The four products are therefore: **Enstellar** = real intake shell with a dormant lifecycle behind it; **Digicore** = a ~15–20% knee-demo stub; **RevitalAI** = real code that can never complete a run; **Qualitron** = scaffolding. Prior smokes looked green because they bring up a **thin subset** of services and only assert the synchronous front door — never the lifecycle or the broken services.

---

## Maturity map

**Legend:** ✅ solid · 🟡 partial/degraded · ❌ broken/missing

### Platform substrate
| Component | Exists | Builds | Runs | Proven | One-line reality |
|---|---|---|---|---|---|
| **Document service** | ✅ | ✅ | ✅ | 🟡 | The one genuinely production-shaped service: `pnpm deploy` image, healthcheck, real endpoints, real RLS. Tests mock the DB though. |
| **Control Plane** | ✅ | ✅ | 🟡 | 🟡 | Builds + boots; real tenant/cell/entitlement logic; **no healthcheck**, 2 support endpoints are Phase-1 stubs. |
| **Contracts / codegen / guards** | ✅ | ✅ | ✅ | ✅ | Healthiest backbone piece — schemas, py/ts/java codegen, breaking-change + conformance guards all pass in CI. |
| **Postgres + Flyway/Alembic + RLS** | ✅ | ✅ | ✅ | 🟡 | One Postgres, ~13 schemas, FORCE RLS enforced via non-superuser roles. `shared.outbox` defined in two DBs (drift risk). |
| **Keycloak realm + OPA adverse-action gate** | ✅ | ✅ | ✅ | 🟡 | Realm valid, JWT validation real, the adverse-action OPA gate is enforced & proven. Audience unverified in dev; rbac/automation rego dead. |
| **Event plane (outbox→Kafka relay)** | ✅ | — | ❌ | ❌ | **`OutboxRelay` is fully written but never started anywhere.** Nothing drains `shared.outbox`. The single biggest broken link. |
| **Temporal (server/worker/namespace)** | 🟡 | — | ❌ | ❌ | Server in compose, but **no worker process exists** and the `simintero` namespace is never registered in compose. |
| **model-gateway** | ✅ | ❌ | 🟡 | ❌ | Crash-loop Dockerfile (dangling pnpm symlinks), no healthcheck, returns raw string not structured, audit-INSERT hits a non-existent `payload` column, hard-depends on absent VKAS. |
| **VKAS** | 🟡 (library) | ❌ | ❌ | ❌ | **Not a service** — no entrypoint/Dockerfile/compose. `:resolve` is a hardcoded 501. Only `promotions` logic is real but unreachable. |
| **mock-llm** | ❌ | — | — | — | Doesn't exist. (`ollama` is in compose but model-gateway has no Ollama adapter.) |
| **Terminology service** | ❌ | — | — | — | No platform service. Only a phantom-gateway validator buried in digicore-authoring; runtime expansion is an empty stub. |
| **Task/Worklist service** | ❌ | — | — | — | Doesn't exist. Qualitron POSTs to `task-service.internal` (a hostname only a test sets). |
| **Provenance** | 🟡 (schema) | — | — | — | Just a `provenance_ref TEXT` column convention; no service. |
| **search / analytics / claims** | ✅ | 🟡 | ❌ | ❌ | Entrypoints are `export {};` → load and exit immediately. Real routes exist as dead code. |
| **automation / market-bundles** | ✅ | ❌ | 🟡 | 🟡 | Actually boot a server (no healthcheck, crash-loop-prone Dockerfile); market-bundles CRUD is real+tested. |

### Products
| Product | Exists | Builds | Runs | Proven | Reality |
|---|---|---|---|---|---|
| **Enstellar (PA)** | ✅ | ✅ | 🟡 | 🟡 | Front door works end-to-end + proven by IT; **entire post-submit lifecycle is dormant** (no relay, IntakeConsumer not started, topic-name mismatch). |
| **Digicore** | ✅ | ✅ | 🟡 | ❌ | `digicore-runtime` boots & answers, but decisioning is a hardcoded **knee/CPT-27447** stub; real ELM evaluator supports only 2 operators on one fixture; authoring/registry undeployed + blocked by VKAS 501. `/healthz` is mis-packaged (404). |
| **RevitalAI** | ✅ | ✅ | 🟡 | ❌ | Good engineering (real Dockerfile, real activities, citation-grounding), but **can never complete a run** — no Temporal worker, and `persistAdvisory` throws on the `payload` column. |
| **Qualitron** | 🟡 | ❌ | ❌ | ❌ | Scaffolding: entrypoint exits immediately, eligibility query reads 4 columns that don't exist on `ens.case`, outreach target doesn't exist, all measure logic outsourced to digicore. |

---

## Per-component detail

### Platform substrate

**Document service** (`platform/services/document/`) — the healthiest substrate service. `src/index.ts` wires `/healthz`, ingest, span, metadata, list, redact, redaction-view; ingest persists raw bytes before the DB write and writes `docs.document` under RLS. `Dockerfile:18` uses `pnpm --filter @sim/document deploy --prod --legacy /app/deploy` (self-contained, no symlink crash). It is the only platform Node service with a compose healthcheck (`docker-compose.yml:140-145`), and `interop` gates on its health. Real transaction-local RLS via `src/db/withTenant.ts` + `docs.document` FORCE RLS policy (`V005__docs_revital_schema.sql:22-25`). **Gap:** tests mock the pg pool, so cross-tenant RLS isn't proven against a live DB.

**Control Plane** (`platform/services/control-plane/`) — tenant/cell/entitlement provisioning with PHI guards, immutable tenant_id, a real Keycloak admin client. `Dockerfile:35` uses `pnpm deploy --legacy --prod` (self-contained). In compose (`:169-188`, port 3012) but **no healthcheck**. `routes/support.ts:160,175` (timeline, diagnostic-bundle) are explicit Phase-1 stubs; the rest is real.

**Contracts / codegen / guards** — the strongest backbone piece. Canonical JSON Schema + envelope + event payloads, 5 OpenAPI, 1 AsyncAPI under `contracts/`; py/ts/java codegen runs and is committed; services consume the generated `canonical_model` widely. The breaking-change guard (`contracts/scripts/check-breaking-changes.js`) and conformance guard (`scripts/check-no-legacy-contracts.sh`, 8 invariants C2a–I2a) both run in CI and pass. **Gap:** event-payload schemas aren't code-generated (offline `$ref` resolution), so event bodies aren't type-checked against drift.

**Postgres + migrations + RLS** — one Postgres, four logical DBs (`simintero` via Flyway V001–V016 with ~13 schemas; `workflow` via Alembic 0001–0011; `keycloak`; `hapi`). Services run as the non-superuser `workflow` role, so FORCE RLS is genuinely enforced. `00-databases.sql` pre-creates the `BYPASSRLS sim_relay` role. **Gap:** `shared.outbox` is defined by both Flyway V002 (`simintero`) and Alembic 0011 (`workflow`) with no cross-DB equivalence check — drift risk.

**Identity / authz** — Keycloak realm `simintero` is valid and self-contained (clients, reviewer/medical_director roles, test users). JWT validation via JWKS/RS256 is real. OPA serves three rego policies but **only `sim/guards/adverse_action` is actually enforced** (every adverse transition in `engine/transitions.py:241-250`) — and that path is proven. **Gaps:** `rbac/roles.rego` and `automation_gate.rego` are dead code; `oidc_audience` defaults to `None` in workflow-engine and portal-bff (audience unverified in dev); model-gateway has no auth at all; `POST /cases/{id}/transitions` has no auth dependency.

**Event plane (outbox → Kafka relay) — DEAD.** The Python `OutboxRelay` (`services/enstellar-workflow/.../outbox/relay.py:20-83`) is fully implemented (polls `shared.outbox WHERE published_at IS NULL`, `SET ROLE sim_relay`, publishes to Kafka) **but is never instantiated or started** — `main.py` lifespan starts only `AutoDeterminationConsumer` and `ClinicalReviewConsumer`; there is no relay compose service. The platform TS relay likewise has no runtime caller. **Impact:** every domain write goes to `shared.outbox` and never reaches Redpanda; `decision.recorded`, `case.state.changed`, etc. are produced into the DB only; the Java interop `DecisionEventConsumer` and the Python consumers idle. **This is the single biggest broken link.**

**Kafka consumers** — four real `IdempotentKafkaConsumer` subclasses exist (`AutoDeterminationConsumer`, `ClinicalReviewConsumer`, `IntakeConsumer`, `RfiResponseConsumer`); **only two are started** (`main.py:70-76`). `IntakeConsumer` + `RfiResponseConsumer` are never instantiated. The intake path is broken three ways: interop publishes to `case.intake.received` (`CaseIntakePublisher.java:79`) but `IntakeConsumer` subscribes to `sim.case.lifecycle` (`Topics.CASE_LIFECYCLE`); the consumer isn't started; and no relay runs. Interop's `CaseIntakePublisher` writes **directly** to Kafka (not the outbox), so it's the only producer reaching Kafka — but nothing consumes its topic.

**Temporal — no worker, namespace not registered.** `temporal` (auto-setup:1.24) + `temporal-ui` are in compose (`:81-107`); ~10 services set `TEMPORAL_NAMESPACE=simintero`, but **auto-setup only creates `default`** and the `simintero` namespace is registered only by an unused k8s job (`infra/k8s/jobs/temporal-init.yaml:26`). **There is zero Temporal worker anywhere** (no `Worker.create`/`@temporalio/worker` import in non-test source). Revital starts `revital-analyze-case` via client with no namespace and no taskQueue → workflows hang forever.

**Tenancy / RLS primitives** — correct in py/ts/java (`tenant_transaction` does `set_config('sim.tenant_id', $1, true)`). API routes and `CaseService` use them. **Gap:** several consumer/handler paths do bare `pool.acquire()` writes without setting the GUC (`comms/consumers/decision_recorded.py:29`, `auto_determination_consumer.py:94`, `clinical_review_consumer.py:243/347/389`) — under FORCE RLS these would affect 0 rows / fail the WITH CHECK once they handle real traffic.

**model-gateway** (`platform/services/model-gateway/`) — `/inference` exists (InferenceDispatcher: kill-switch → VKAS resolve → boundary → PHI filter → Anthropic adapter → audit). Three fatal problems: (1) `Dockerfile:33` `COPY .../node_modules` are dangling pnpm symlinks → crash-loop at boot; no healthcheck; (2) `InferenceDispatcher.ts:110` returns `output = raw_output` (a plain string; `AnthropicAdapter.ts:38` = `data.content[0].text`) — activities expect structured `output.{entities|assertions|suggestion}`; (3) audit step `INSERT INTO shared.outbox (tenant_id, topic, payload)` hits a non-existent `payload` column (real columns `event_id/key/envelope` NOT NULL) → throws on every successful dispatch. Hard-depends on VKAS (`VKAS_URL: http://vkas:3040`, a host that doesn't exist). The kill-switch (`ctrl.entitlement`) query is schema-correct and the most mature piece, but stranded.

**VKAS** (`platform/services/vkas/`) — **a library, not a service.** `package.json` exports only `./src/router.ts`; no `index.ts`/Pool/`app.listen`/Dockerfile, and no `vkas` compose service. `GET /v1/artifacts:resolve` and `POST /v1/artifacts` and `submit` all return **501** ("Not implemented in Phase 0 stub"); only `POST /v1/promotions` is DB-backed and real (but unreachable). The `resolveEffectiveVersion` algorithm (`resolve.ts:28`) is a real pure function operating on in-memory rows — never fed from a DB. This single gap blocks both **model-gateway inference** and **digicore rule authoring**.

**mock-llm** — does not exist. `ollama` is in compose (`:446`) but model-gateway's `adapterFor` only knows `'anthropic'`, so nothing routes to it; the AnthropicAdapter `fetch(\`${endpoint}/v1/messages\`)` has no real or mock endpoint configured.

**Terminology service** — no platform service. The only validator is library code in `modules/digicore/authoring/src/terminology/TerminologyBindingValidator.ts:34` calling a phantom `http://localhost:3030`; digicore-authoring isn't even in compose. Runtime expansion (`ExpansionCache.java`) returns empty for every key (Phase-2 stub). `vsac-proxy` is real but only does OID→concept, not FHIR `$validate-code`.

**Task/Worklist service** — doesn't exist. `modules/qualitron/gaps/src/OutreachTaskCreator.ts:19` POSTs to `${taskServiceUrl}/v1/tasks`, but the URL is only set in a test (`http://task-service.internal`); the qualitron compose block sets no `TASK_SERVICE_URL`. (Enstellar's `/worklist` routes are a separate concern proxying the workflow-engine.)

**Provenance** — schema-only: a `provenance_ref TEXT` column on `fabric.resource` and `docs.document`; no service, no table.

**Business modules** — `search` (3019) and `analytics` (3020) and `claims` (3016) have `src/index.ts = export {};` so they exit immediately at runtime despite real route code; `claims` is the cruel case (the only one with a correct `pnpm deploy` Dockerfile, yet never boots). `automation` (3017) and `market-bundles` (3018) actually `app.listen` (no healthcheck, crash-loop-prone Dockerfiles); market-bundles CRUD + reviewer-gate is real and tested.

### Products

**Enstellar (PA)** — strong at the front door, dormant past it. Working & proven: FHIR PAS `$submit → ClaimResponse(queued)` with raw-bundle-to-MinIO, validation, normalization call, direct-to-Kafka intake emission, `$inquire` polling; CRD CDS-Hooks cards from live digicore coverage content; I2a document ingestion (Binary/DocumentReference/QR → document-service, best-effort); portal-bff proxy + Keycloak JWT auth (52 tests, upstreams mocked); the React portal builds; a Testcontainers IT proves the async `$submit→$inquire` round-trip (collaborators WireMocked). **Core gap (wired-but-dormant):** because the OutboxRelay and IntakeConsumer are never started (and the intake topic name mismatches), interop's intake event is never consumed → no workflow case is created → no transition events reach Kafka → the (real) clinical_review and auto_determination consumers never fire. The reviewer worklist therefore returns an empty list at runtime (the smoke only asserts HTTP 200). The clinical-advisory pipeline (agent-layer LangGraph) and digicore decision logic are real code that never executes end-to-end.

**Digicore** — ~15–20% real, and that fraction is a knee demo. `digicore-runtime` (Java/Spring) boots, has a self-contained Dockerfile, is in compose, and serves the four C-1 endpoints — but decisioning is a hardcoded **knee/CPT-27447** stub: `CoverageDiscoveryController.java:27-28` keys on `"knee"`/`"27447"`; `EvidenceRequirementsController` only answers for "knee"; `DtrPackageController.java:34-35` ignores the `{ref}` and always returns the knee package. The real `ElmEvaluator` is a genuine but toy interpreter supporting only `EvidencePresent` + `And` over a single 4-statement knee fixture (unit-tested). `DefaultVkasClient` returns the hardcoded knee pin (never calls platform VKAS). `/internal/compile` returns the knee ELM regardless of CQL. `/healthz` is mis-packaged (outside the component-scan root → 404; compose probes coverage-discovery instead). The designed authoring/governance/registry/simulation services exist as tested TS but are **not in compose** and are blocked by VKAS 501. The Python connector calls evaluate with `evidence={}`, so the only reachable live outcome is `not_met → pending_review`. The I1 smoke proves the endpoint accepts a knee claim, not a real determination. **Biggest gap: no path from an authored coverage rule to a runtime decision.**

**RevitalAI** — real code, structurally dead end-to-end. `revital-pipeline` starts an Express API + Temporal *client* only; its Dockerfile correctly uses `pnpm deploy` (self-contained); the activity chain, the `revital-extraction` library, and downstream services (document-service, model-gateway, digicore-runtime) all exist and make real calls (including a real Anthropic adapter + citation-grounding INV-2). **Cannot produce a completed analysis** for two independent reasons: (1) no Temporal worker, so `revital-analyze-case` is never executed (rows stay `processing`); (2) even with a worker, `persistAdvisory.ts:53` INSERTs the non-existent `payload` column → throws. Plus: the `simintero` namespace isn't in compose; `DOCUMENT_SERVICE_URL`/`DIGICORE_URL` aren't injected (defaults hit wrong ports → silent abstain); every external-dep activity abstains on failure; PDF span parsing is a line-split placeholder. Real engineering, missing last-mile wiring.

**Qualitron** — scaffolding. `modules/qualitron/` is library functions + Express routers never mounted; `execution/src/index.ts` is pure re-exports (no `app.listen`) so the container loads and exits 0; the Dockerfile uses the dangling-symlink pattern; only `execution` is in compose (port 3015, no healthcheck). `qualitronRunMeasure` is never called by the route (which only writes a `'pending'` row); measure logic is outsourced to digicore (`evaluateMeasure.ts:20`). `fetchEligibleMembers.ts:8-15` reads `member_id/period_start/period_end/status` from `ens.case`, which has none of those columns (it has `member_ref`, `state`) → throws. The outreach `task-service` doesn't exist. `V006__qual_schema.sql` is pure DDL with no backing running code. Tests are mocked unit stubs.

---

## The three systemic defects (the real story)

Everything above collapses into three root causes — fix these and most of the map turns green.

**1. TypeScript services don't boot.** The crash-loop Dockerfile pattern (`COPY platform/services/<svc>/node_modules` = dangling pnpm symlinks) hits model-gateway, search, analytics, automation, market-bundles, qualitron. Separately, several entrypoints are literally `export {};` (search, analytics, claims) so they load and exit. Only document-service, control-plane, claims, revital-pipeline use the correct `pnpm deploy --legacy --prod`. **Net: a full `docker compose up` would have a row of crash-looping / instantly-exiting containers** — which is why only the thin smoke subset "passes."

**2. The event plane is dead.** The `OutboxRelay` (drains `shared.outbox` → Redpanda) is written but **started by nothing**. So every domain write lands in the DB and never reaches Kafka. On top of that, `IntakeConsumer` + `RfiResponseConsumer` are never instantiated, and interop publishes intake to `case.intake.received` while the consumer listens on `sim.case.lifecycle`. **Result: `$submit` succeeds, but no workflow case is ever created and no consumer ever fires.** This is why the worklist is empty and the (real) clinical-review/auto-determination engines never execute.

**3. No Temporal worker + VKAS isn't a service.** Revital submits workflows to a queue nothing polls, in a namespace that isn't registered → analyses hang at `processing`. And VKAS — the artifact/version store that both model-gateway inference and digicore rule authoring depend on — is a library returning 501, so the entire AI-inference and coverage-rule-lifecycle layer is walled off.

---

## Recommended re-sequencing

The convergence work so far (contracts, monorepo landing, tenancy/authz, unified stack, I1 real-digicore-wiring, I2a doc bridge) is **real and sound** — it built the spine and the front door. The recommended pivot is to stop adding thin product slices and **make the platform demonstrably run end-to-end**, in dependency order. The in-flight I2b work (0a/0b/1) is a subset of this and slots in cleanly.

**F1 — Stack runtime integrity (highest leverage, do first).** Repo-wide: fix every TS Dockerfile to `pnpm deploy --legacy --prod`, fix the `export {};` entrypoints (search/analytics/claims) to actually `listen`, add healthchecks everywhere. *Outcome:* `docker compose up` brings up a stack where every service is genuinely healthy. Biggest clarity + credibility win; unblocks F2–AI1.

**F2 — Bring the event plane to life (makes Enstellar a real product).** Start the `OutboxRelay` (workflow-engine lifespan and/or a dedicated service), start `IntakeConsumer` + `RfiResponseConsumer`, reconcile the intake topic name, wrap unguarded consumer writes in `tenant_transaction`. *Outcome:* `$submit` → case created → clinical_review → auto-determination flows; the PA lifecycle is live (with stub advisory/decision). Also fixes I1's dormant `AutoDeterminationConsumer`.

**F3 — Temporal execution** = **I2b-0b** (worker + `simintero` namespace + persistAdvisory outbox-column fix + tenant-GUC). *Outcome:* Revital runs to a terminal status.

**AI1 — VKAS + inference foundation** = **I2b-0a** (VKAS as a real service + resolve wired to DB + seed; model-gateway Dockerfile/output/outbox fixes; mock LLM). *Outcome:* `/inference` returns structured output → Revital produces real grounded output → **I2b-1** wires it into clinical_review. Bonus: VKAS-as-a-service also unblocks Digicore rule authoring.

**P1 — Product depth (after the foundation runs):** Digicore real rules (authoring→VKAS→runtime, real CQL/ELM, terminology service), Qualitron (fix `fetchEligibleMembers`/`ens.case` columns, stand up a Task/Worklist service, real measure logic), and the platform Terminology + Task services multiple products need.

**Key reframe:** F1+F2 alone convert Enstellar from "intake shell" to "working PA product end-to-end," and they're far cheaper than the AI epic. Do **F1 → F2** next regardless of the Revital/AI direction, because every product needs a stack that boots and an event plane that flows.

---

## What definitively works today (so it's not all red)

- FHIR PAS `Claim/$submit` → `ClaimResponse(queued)` + `$inquire`, with raw-bundle persistence, validation, normalization, and direct Kafka intake emission (proven by a Testcontainers IT).
- Document service: ingest / metadata / span / list / redact, with real transaction-local RLS (I2a).
- portal-bff worklist/case proxy + Keycloak JWT role-gating; the React reviewer portal builds.
- Contracts + py/ts/java codegen + breaking-change & conformance guards (green in CI).
- Postgres single-instance with ~13 schemas and FORCE RLS enforced via non-superuser roles.
- Keycloak realm `simintero` + the OPA adverse-action gate (enforced & proven).
- digicore-runtime's ELM evaluator (toy but real, unit-tested) and the `ctrl.entitlement` kill-switch.
- Market-bundles CRUD + reviewer-gate (real, tested) — though not depended on by anything running.
