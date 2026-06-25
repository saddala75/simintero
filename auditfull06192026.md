# Simintero Platform — Code-Level Production Readiness Audit

**Date:** 2026-06-19
**Commit audited:** `d5ad2fa` (main) — *feat(P1-d): platform Terminology service*
**Method:** Six parallel read-only code-level sub-audits (substrate + 4 products + cross-cutting), grounded in source / `docker-compose.yml` / Dockerfiles / tests / CI / migrations — **not** docs, comments, or memory. Rubric per capability: **Exists → Builds → Runs (wired in compose, boots) → Proven (real test/smoke exercises it)**.
**Supersedes:** `auditfull06162026.md` (2026-06-16). This audit reflects the post–F1/F2/F3/AI1/I2b/P1 state.

> **Rating scale:** Not-started · Scaffolded · Functional-unproven · Functional-proven · Production-hardening-needed · Production-ready

---

## 0. Bottom line

The platform has a **real, deeply-integrated happy-path spine**: a PAS prior-authorization submission flows intake → normalize → event-plane → Digicore rule evaluation → Revital advisory → determination → Qualitron measure/gap → task, and a 15-step unified smoke proves it across 21 services. On the *Enstellar PA auto-approval path* this is well beyond demo-ware.

But **"P1 complete / all four products run end-to-end" holds only in the happy-path demo sense.** Underneath: three of the four products are largely scaffolding around a thin proven path; the cross-cutting layer (edge auth, FHIR conformance, observability, CI integration gates) is unwired; and the only integration proof runs nowhere automated. **Nothing here is production-ready today.** Honest state: **integrated prototype with one strong product spine (Enstellar).**

### Readiness scorecard

| Component | Rating | One-line |
|---|---|---|
| **Platform substrate** | Functional-unproven (1 critical hole) | Strong RLS *design*, real services; TS event plane dead, tenant isolation unproven, docs on `/tmp` |
| **Enstellar** (interop + workflow) | **Functional-proven spine / hardening needed** | Most mature product; real PAS/X12/US Core, proven auto-approval PA; appeals absent, clocks/stages hardcoded |
| **Digicore** (policy-as-code) | Core: hardening-needed / periphery: scaffolded | Real CQF CQL→ELM compiler + deterministic fail-safe eval; boolean-criteria not CQL-vs-FHIR, governance store in-memory, DTR/licensed/registry/sim absent |
| **Revital** (governed AI) | Scaffolded → Functional-unproven | Excellent governance rails (advisory-only, enforced grounding, abstention); AI is mock-only — no real OCR/extraction/terminology/eval |
| **Qualitron** (quality) | Scaffolded → Functional-unproven | Thin proven demo (execution only); bespoke SQL checker not CQL/MeasureReport; "author in Digicore" claim false in code; reporting/aggregation unmounted |
| **Cross-cutting / run-state** | Not production-ready | Deep smoke but local-only; deployed UI can't auth; conformance orphaned; no observability/TLS/secrets mgmt |

---

## 1. Platform substrate — *Functional-unproven, one critical hole*

**Components (under `platform/services/` unless noted):** control-plane, db-migrations, vkas, task-service, terminology-service, document, model-gateway, mock-llm, opa-policies, rls-harness; eventing (`shared.outbox` + relays).

### Per-component readiness

| Component | E / B / R / P | State | Rating |
|---|---|---|---|
| control-plane | ✓/✓/✓/partial | Real pg-backed tenant/cell/entitlement CRUD + outbox + Keycloak; 2 Phase-1 stubs; tests mock pg | Functional-unproven |
| db-migrations / schema | ✓/✓/✓/partial | 13 schemas, ~23 tables, RLS ENABLE+FORCE uniform, real `sim.tenant_id` GUC policies | Production-hardening-needed |
| RLS enforcement (harness) | ✓/✓/partial/✗ | Harness runs as superuser `postgres` (RLS-exempt); CI applies no migrations first → proof vacuous | Scaffolded |
| vkas | ✓/✓/✓/partial | Real DB-backed artifact store, content-hash, immutability trigger; **never sets tenant GUC** | Functional-unproven |
| task-service | ✓/✓/✓/partial | Real `task.task` CRUD, `withTenant`, lifecycle 422s, outbox INSERT (never drained); tests mock pg | Functional-unproven |
| terminology-service | ✓/✓/✓/partial | Stateless VKAS proxy; real `$validate-code` membership + `$expand` pass-through; 404 on unseeded | Functional-unproven |
| document | ✓/✓/✓/partial | Filesystem byte store (`/tmp`); ingest/list/redact real; Temporal pipeline orphaned; `emitDocumentReady` outbox INSERT would crash | Scaffolded→Functional-unproven |
| model-gateway | ✓/✓/✓/partial | Real VKAS→mock-llm→JSON path + outbox audit (smoke step 10); no OPA on `/inference`; finops bucket bug | Functional-proven |
| mock-llm | ✓/✓/✓/✓ | Deterministic structured JSON per task_kind | Functional-proven |
| opa-policies | ✓/✓/✓/partial | 3 real policies; only `adverse_action/allow` consulted at runtime; rbac+automation_gate dormant | Functional-unproven |
| Eventing (TS outbox→relay→Kafka) | partial/✓/✗/✗ | `relayBatch()` exists but never wired; no TS Kafka producer | **Scaffolded (dead)** |
| Eventing (Python workflow-engine) | ✓/✓/✓/✓ | Real `OutboxRelay`+consumers started in `main.py`; proven by smoke F2/I2b | Functional-proven |

### Critical hole — the substrate event plane is dead
Every TS substrate service writes a transactional outbox (`shared.outbox`), but `libs/outbox/ts/src/relay.ts::relayBatch()` is **never invoked in non-test code**, there is **no TS Kafka producer**, and the only live relay (`services/enstellar-workflow/.../outbox/relay.py`, started `main.py:84-88`) polls `shared.outbox` in a **different database** (`workflow` vs `simintero`, `docker-compose.yml:835`). Substrate-native events (control-plane, task, document, model-gateway) **never reach the broker**; their rows accrue `published_at=NULL` forever. The PA flow works only because Enstellar's Python relay+consumers are self-contained. Additionally `document/src/pipeline/activities.ts:42` INSERTs into a nonexistent `payload` column omitting NOT-NULL `event_id`/`key`/`envelope` — would throw if the orphaned pipeline ran.

### Multi-tenancy / RLS — design strong, enforcement unproven
RLS *design* is rigorous and uniform (e.g., `V002:16-19`, `V003:24-28`; `vkas.artifact` adds `OR tenant_id='shared'`). The `withTenant`/`set_config('sim.tenant_id',…,true)` pattern is correctly used in task-service, document ingest, model-gateway. **But:** (1) **VKAS never sets the tenant GUC** (zero `set_config` in `vkas/src` — either RLS-bypassed as superuser or silently broken per-tenant); (2) document read paths use bare `pool.query`; (3) the **rls-harness proves nothing** — CI connects as superuser `postgres` (RLS-exempt under FORCE) and applies **no migrations** first (`ci.yml`). Every substrate test **mocks `pg`** — no real-Postgres integration test exists.

### Other substrate gaps
Document bytes on **ephemeral `/tmp`** (MinIO present but unused, no S3 impl); document Temporal ingest pipeline orphaned (stubbed classification, no OCR/virus-scan); model-gateway skips OPA on `/inference` + finops cost-summary groups by a `payload->>'module'` that is never written (all costs collapse to null bucket); VKAS app status `rolled_back` violates the DB CHECK (`superseded`).

---

## 2. Enstellar — *the genuine spine; Functional-proven on auto-approval, hardening needed overall*

**Live tree** = `simintero/services/enstellar-*` (compose builds exclusively there: interop→`services/enstellar-interop` Java, workflow-engine→`services/enstellar-workflow` Python, portal-bff Python, web→`services/enstellar-portal`). The separate `Enstellar/` git tree is a **stale upstream snapshot** (see §6).

### Per-capability readiness

| PRD area | E/B/R/P | State | Rating |
|---|---|---|---|
| ENS-INT intake & channels | ✓/✓/✓/✓ | FHIR PAS `$submit`/`$inquire` real; raw bundle → MinIO before transform; correlation ID assigned | Functional-proven |
| X12 278/275 | ✓/✓/partial/✓ | 278 parse+round-trip real & tested; **275 response mapper not implemented** | Production-hardening-needed |
| ENS-MDL canonical case model | ✓/✓/✓/✓ | Normalized Case + append-only `workflow_events` history + snapshots; tenant/LOB propagated | Functional-proven |
| ENS-DOC CRD / DTR | ✓/✓/✓/partial | CRD `/cds-services` + DTR Questionnaire/Response providers real; **CQL serving / completeness-gap engine absent** | Functional-unproven |
| ENS-WF workflow engine | ✓/✓/✓/✓ | Lifecycle stages first-class; auto-determination real & property-tested; idempotent; **stages hardcoded, not metadata-driven**; NOT Temporal | Functional-proven (config gap) |
| ENS-EVT event plane | ✓/✓/partial/✓ | Relay+consumers started; auto-determination flows; two dead Kafka paths | Production-hardening-needed |
| ENS-RUL Digicore rules | ✓/✓/✓/✓ | Real HTTP to digicore `/v1/runtime/evaluate` w/ retry+breaker; rules trace persisted | Functional-proven |
| ENS-AI Revital + sign-off | ✓/✓/✓/✓ | Real async submit/poll; advisory-only; **human sign-off dual-gated (in-proc + OPA)**; **model/prompt version NOT captured** | Functional-proven (provenance gap) |
| ENS-CLK clocks / SLA | ✓/✓/partial/✓ | Real clocks + pause-on-RFI proven; **no active breach-monitor poller**; durations hardcoded | Production-hardening-needed |
| ENS-COM communications | ✓/✓/partial/✓ | Jinja2 letters, PHI-safe, per-tenant; fires on auto determinations; **may miss human-decided cases** | Functional-proven (partial) |
| ENS-APP appeals | ✗/✗/✗/✗ | No appeal/reconsideration/peer-to-peer states; only queue escalation | **Not-started** |
| ENS-API FHIR conformance | ✓/✓/✓/partial | CapabilityStatement (US Core 5.0.1 + PAS 2.0.1); SMART/Backend JWT + audience enforced; Inferno US Core+SMART in CI; **PAS suite not executed** | Production-hardening-needed |
| ENS-UI reviewer workspace | ✓/✓/✓/✓ | Real worklist/timeline/criteria/AI panel/decision capture wired to BFF; Playwright+pytest prove flow | Functional-proven |
| ENS-CFG config-driven | partial/✓/✓/✓ | Env config + per-tenant templates only; clocks & stages are **hardcoded constants** | Scaffolded |

### PA happy-path verdict
**Yes — an end-to-end auto-approval PA flows today and is PROVEN.** Real intake is synchronous HTTP (interop `$submit` → `/internal/normalize` creates case + transitions intake→auto_determination) → OutboxRelay carries `CaseStateChanged` → AutoDeterminationConsumer calls Digicore → on "approved" emits `DECISION_RECORDED` → notification rendered → `$inquire` returns a complete ClaimResponse. Proven by (1) Playwright real-stack e2e (CRD→DTR→`$submit`→approval→`$inquire`) and (2) CI `pytest` with **Testcontainers (real Postgres + Redpanda), integration tests NOT filtered out**.

### Top Enstellar gaps
1. **Async intake Kafka path dead/duplicated** — interop publishes `case.intake.received`; consumer listens on `sim.case.lifecycle` and is never started. Single synchronous path = no async resilience.
2. **DTR/CQL completeness-gating absent** before auto-determination (ENS-DOC unmet).
3. **Determination→notification may not fire for human/adverse decisions** (only auto path emits `DECISION_RECORDED`) — regulatory-notice risk.
4. **No SLA breach monitoring** (`check_breach` never invoked).
5. **Appeals (ENS-APP) entirely absent** — v1 must at zero.
6. **Clocks & workflow stages hardcoded**, not metadata-driven (ENS-CFG/ENS-WF).
7. **X12 275 response mapper missing.**
8. **Conformance not fully proven** — PAS test kit loaded but not executed; real-stack e2e gated behind a flag with no CI evidence.
9. **AI provenance gap** — Revital result captures confidence but not model/prompt version.

---

## 3. Digicore — *real deterministic core, scaffolded periphery*

**Deployed (compose):** digicore-runtime (Java, 8083), digicore-authoring (3052), digicore-governance (3053). **`digicore-registry` and `digicore-simulation` have no Dockerfile and are NOT in compose.**

### Per-capability readiness

| PRD area | E/B/R/P | State | Rating |
|---|---|---|---|
| DIG-RT runtime decision svc | ✓/✓/✓/✓ | Real CQF cql-to-elm; resolves rule→ELM from VKAS, abstains on miss, auto-approve only on `meets_all`; ~60 tests | Production-hardening-needed |
| DIG-TRC rules trace | ✓/✓/✓/partial | Structured `logicPath`+gaps, deterministic; evaluate path uses non-persisting `newTraceRef()` | Functional-proven |
| DIG-AUTH authoring | ✓/✓/✓/partial | CQL compile via real HTTP; coverage_rule draft→submit→governance real; **DTR Questionnaire authoring absent**; terminology check is a 404-probe | Functional-unproven |
| DIG-GOV governance | ✓/✓/✓/partial | Dual-gate + SoD + block-without-approval correct & unit-proven; **store is in-memory `Map`** | Functional-unproven |
| DIG-VER versioning/rollback | ✓/✓/✓/partial | VKAS lifecycle + effective-dating + DB immutability proven; **rollback absent**, diff presence-only | Production-hardening-needed |
| DIG-REG registry/taxonomy | ✓/partial/✗/✗ | Detail route real; search has no OSClient; no relationships; **no Dockerfile, not in compose** | Scaffolded |
| DIG-MAP applicability | ✓/✓/✓/partial | VKAS `resolveEffectiveVersion` matches lob/region/program/product+date+semver; **no conflict detection**; runtime passes `RuleContext.empty()` | Functional-unproven |
| DIG-SIM simulation | ✓/✓/✗/partial | ScenarioRunner real HTTP+persist; **HistoricalReplayer returns []**, blast-radius hardwired empty; not in compose | Functional-unproven |
| DIG-LIC licensed content | ✗ | No InterQual/MCG/NCD/LCD referencing/provenance anywhere | **Not-started** |
| DIG-TRM terminology | ✓/✓/✓/partial | `$validate-code` real; **`$expand` pass-through, no VSAC sync, no ConceptMap**, 3 hand-seeded value-sets | Functional-unproven |
| DIG-CRD CRD/DTR production | partial | Runtime serves DTR/coverage discovery; `dtr_package_ref` opaque passthrough, no Questionnaire generation | Scaffolded |
| DIG-PUB publishing/promotion | ✓/✓/✓/partial | Governance activate → VKAS `/activate`; no retry/transactionality, partial-activation risk | Functional-unproven |
| DIG-CFG multi-tenancy | partial | VKAS/registry/sim use RLS; **authoring & governance enforce no tenant context/auth**; `created_by` untrusted | Functional-unproven |
| DIG-AUD audit/control-evidence | partial | Outbox events emitted; governance outbox no-op unless env set; approval ledger in-memory | Scaffolded |

### CQL engine verdict
The CQL→ELM **compiler is real, not a toy** (HL7/CQF `cql-to-elm` 3.x + `elm-jackson`, real error surfacing). The evaluator is **deterministic** (declaration-order iteration, Kleene 3-valued, fail-loud, dedicated DeterminismTest) and **fail-safe** (`eligible=true` only on `meets_all`; abstains `indeterminate` on any rule/ELM resolution miss — never default-approves). **However it is NOT a FHIR Clinical Reasoning engine:** `ElmInterpreter` supports only Literal/ParameterRef/ExpressionRef/And/Or/Not/Exists/Equal/comparisons — **no FHIR data model, no Retrieve, no value-set membership against clinical resources, no intervals/lists/quantities/temporal logic.** Rules are parameter-based boolean gates where the *caller* pre-distills clinical facts into booleans. Production-grade compile path; narrow boolean-criteria *decisioning*. This is the single largest functional gap for real clinical policy-as-code.

### Governance / versioning verdict
Gate logic is **logically correct and unit-proven** (clinical AND compliance required; SoD author≠approver 403; activation blocked 409 + VKAS never called first) — but the **entire approval store + "immutable change log" is an in-memory `Map` (`governance/index.ts:35`)**, wiped on restart, not shared across replicas. The only persistent trail is an outbox that **defaults to no-op** unless `GOVERNANCE_DB_URL` is set. Versioning is stronger (VKAS lifecycle + DB-enforced immutability + proven effective-dating) but **rollback is unbuilt** and diff is presence-only. **Top gaps:** in-memory governance store (#1, disqualifying for regulated approval); boolean-criteria evaluation (#2); DTR/CRD production absent (#3); licensed content absent (#4); rollback unbuilt + state-model conflict (#5); shallow terminology (#6); registry undeployable (#7); simulation blast-radius stubbed (#8); `RUNTIME_BASE_URL` default port mismatch 3020 vs 8083 (#9); no auth/tenant enforcement on authoring/governance — SoD/audit spoofable (#10).

---

## 4. Revital — *governance rails real, the AI is mocked*

**Deployed (compose):** revital-pipeline + revital-worker (both from `modules/revital/pipeline/Dockerfile`). Invoked by Enstellar clinical_review (I2b-1) via model-gateway + mock-llm.

### Per-capability readiness

| PRD area | E/B/R/P | State | Rating |
|---|---|---|---|
| REV-ING ingest/parse/OCR | ✓/✓/✓/partial | `parseSegment` fetches one fixed region + newline-splits; "real PDF parsing is Phase 3"; no OCR/classification/segmentation | Scaffolded |
| REV-EXT extraction + normalization | ✓/✓/✓/partial | Real gateway call but `confidence:0.88` hardcoded; normalizer regex-splits a model-supplied `coding_hint` — no terminology service | Functional-unproven |
| REV-SUM grounded summarization | ✓/✓/✓/✓ | `isCitationValid` drops uncited assertions, abstains when none survive; unit-tested | **Functional-proven** |
| REV-EVD evidence-to-criteria | ✓/✓/✓/partial | Consumes Digicore reqs by crude `resource_type` set-membership; `conflicts` hardcoded `[]` | Scaffolded |
| REV-TRI triage + calibration | ✓/✓/✓/partial | Abstains below 0.7, but confidence is model-returned; `calibration_ref` a constant string — no calibration | Functional-unproven |
| REV-GOV advisory/disable/abstention | ✓/✓/✓/✓ | Always `classification:'advisory'`; tenant+workflow kill-switch at route + gateway; abstention gates | Functional-proven |
| REV-TRC per-interaction audit | ✓/✓/✓/partial | Gateway writes real `InferenceServed` outbox (model+prompt version, input_refs, boundary); but Revital advisory stores permanent placeholder `trc_pending` | Production-hardening-needed |
| REV-FB feedback + queue | ✓/✓/✓/partial | Feedback persists + emits; routes hallucination to `sim.ai.ops-review`; **no consumer drains it** | Functional-unproven |
| REV-MOPS registry/canary/rollback | partial/✓/✓/✗ | VKAS versioned/pinned/status-gated resolution; **no canary, cohort, rollback, or clinical-sign-off gate** | Scaffolded |
| REV-EVAL offline eval + drift | partial/✓/✓/✗ | Offline metric fns + unit tests; gate thresholds are pass-everything placeholders; **no online/drift/promotion gate** | Scaffolded |
| REV-MAL pluggable + boundary + PHI | ✓/✓/✓/partial | Real provider abstraction; per-boundary endpoint resolution (hard fail if none); allow-list + regex PHI redaction; one adapter, shallow redaction | Functional-unproven |
| REV-CFG multi-tenant isolation | ✓/✓/✓/✓ | RLS FORCE + tenant GUC on `revital.*`; `withTenant` on writes; tested | Functional-proven |

### AI realness verdict
**The plumbing is real; the intelligence is mocked.** Genuine pipeline: task-typed requests → model-gateway resolves a versioned `model_binding` from VKAS → boundary endpoint → real `AnthropicAdapter` → audit outbox → structured JSON parse. **But in every runnable config the model is `mock-llm` with hardcoded canned outputs** (fixed "osteoarthritis of knee" entity, fixed assertion, fixed `likely_meets`@0.9), just input-aware enough to echo a real span so citation validation passes. No real OCR, extraction, terminology normalization, conflict detection, or calibration. The one model-independent real capability is **grounding enforcement** (uncited assertions dropped → abstain).

### Governance / safety verdict
**The most production-credible part, and structurally enforced.** Advisory-only baked in (no determination path exists); decision boundary correctly in Enstellar with a CI-gated adverse-sign-off property test; per-tenant disable double-checked; abstention gates at three stages; PHI minimized at two layers. **Gaps:** gateway PHI redaction is 3 regexes (narrative PHI in allow-listed `text_segments` passes largely unredacted); 0.7 threshold uncalibrated; no clinical-safety sign-off gate on promotion. **Top gaps:** mock-llm only (#1); REV-ING stub, no OCR (#2); eval/model-ops skeletal — placeholder gates, no drift/canary/rollback (#3); fake terminology normalization (#4); `trc_pending` placeholder provenance breaks citation→source→model link (#5); no conflict detection (#6); fragile compose `depends_on` (#7); hardcoded confidence (#8); feedback queue has no consumer (#9); **Revital forked twice across languages** — TS `revital-pipeline` vs Enstellar Python `agent-layer` (#10).

---

## 5. Qualitron — *thin proven demo, hard parts unbuilt*

**Deployed (compose):** qualitron (from `modules/qualitron/execution/Dockerfile`) only. `aggregation`, `gaps`, `reporting` are libraries; `reporting`/`aggregation` are **unmounted** (no Dockerfile, not in compose).

### Per-capability readiness

| PRD area | E/B/R/P | State | Rating |
|---|---|---|---|
| QUAL-MEAS execution → MeasureReport | ✓/✓/✓/partial | Bespoke SQL num/denom checker over `fabric.resource`; output is **NOT a FHIR MeasureReport** | Functional-unproven |
| QUAL-LOGIC author-in-Digicore | ✗ | Measure logic self-contained JSONB in `qual.measure_definition` (V020), "no digicore"; Digicore never called | **Not-started** |
| QUAL-EVD evidence aggregation + supplemental | partial/✓/✗/partial | Evidence = single coding `[0]` match; supplemental route writes an outbox event nobody consumes; module unmounted | Scaffolded |
| QUAL-GAP gap detection + outreach | ✓/✓/✓/✓ | Gap = `denom && !excl && !num`, persisted; no prioritization/closeability; threshold stubbed 0.0 | Functional-proven (basic) |
| QUAL-CLO gap→Enstellar + reconcile | partial/✓/✓/partial | Gap→task-service HTTP works (smoke); closure only via re-running whole measure; routes to internal task-service not Enstellar | Functional-unproven |
| QUAL-VIEW evidence viewer | partial/✓/✗/✗ | Read API in `reporting` but unmounted; no provenance/evidence viewer | Scaffolded |
| QUAL-RPT dashboards + submission | partial/✓/✗/✗ | `reporting` routes built but not deployed; zero HEDIS/DEQM submission output | Scaffolded |
| QUAL-MAP applicability + period | ✗ | No measure-set→LOB/product/region mapping; period is a free-text param | Not-started |
| QUAL-CFG multi-tenancy | ✓/✓/✓/✓ | RLS `tenant_isolation` on every `qual.*` table; `withTenant` | Functional-proven |
| QUAL-AUD audit/evidence packages | partial/✓/partial/✗ | `qual.measure_run` log + outbox; no immutable ingestion/closure audit, no evidence package | Scaffolded |
| aggregation module | partial/✓/✗/partial | Consumers + unit tests but no server/Dockerfile/compose; emits to topics no one reads | Scaffolded |

### Measure-execution verdict
A **bespoke hand-rolled checker, not digital-measure evaluation.** One SQL query per population component against `fabric.resource`, matching a single hard-coded path `content->'code'->'coding'->0->>'code'` (no value-set membership, single literal code at index `[0]`). Denominator hardcoded `true` for every Patient; exceptions absent; "eligible members" = every distinct Patient `member_ref`. The persisted "report" is the flat `MeasureResult` JSON-stringified — **not a FHIR `MeasureReport`** (no resourceType, no population structure, no DEQM). Deterministic and smoke-proven (4 patients / numerator 2 / 2 gaps), but it proves a SQL aggregate, not measure evaluation. Appendix A (CQL/Library/Measure/MeasureReport, DEQM, ECDS, Bulk Data, terminology) entirely unimplemented.

### QUAL-LOGIC verdict
**The central architectural claim is false in code.** V020 seeds the BCS-E spec as a JSONB `{denominator,numerator,exclusion}` object in `qual.measure_definition`; the workflow loads it with `SELECT spec FROM qual.measure_definition`. The author's own comment reads "self-contained, no digicore." `DIGICORE_RUNTIME_URL` is passed in compose but **no execution/gaps code references digicore, CQL, or any Library/Measure**. No version-governance trail, no effective-dating, no published-Measure import. The "author in Digicore, execute in Qualitron" positioning is unbuilt.

**Top gaps:** no real measure engine / no FHIR MeasureReport (#1); QUAL-LOGIC unimplemented (#2); reporting module not deployed (#3); aggregation not deployed, emits to unconsumed topics (#4); no supplemental-data re-evaluation loop (#5); no submission-ready output (#6); no evidence viewer/provenance (#7); no applicability/period resolution (#8); synchronous in-process loop won't scale (no Temporal worker despite deps) (#9); gap detection stubbed, no outreach prioritization (#10).

---

## 6. Cross-cutting, run-state & convergence — *not production-ready*

### Run-state
~37 compose services (the "44" figure is from an earlier state). The stale smoke comment about "7 broken TS builds" is **fixed** (all 15 TS Dockerfiles now COPY `tsconfig.base.json`). No `export {}`/`sleep infinity`/empty entrypoints in real services. 31/37 have healthchecks (the 6 without are run-once/worker/legit). **1 dead service:** `ollama` (referenced by nothing; mock-llm used instead). Port map clean.

### Smoke coverage verdict
The 15-step smoke is a genuinely deep happy-path integration proof — but it brings up only **21 of 37 services** and is **local-only, never wired into CI**. **Never exercised (~40%):** claims, automation, market-bundles, search, analytics, vsac-proxy, cds-hooks/CRD connector, and the `web` UI. The smoke is the *only* real end-to-end proof and it runs in no pipeline.

### Frontends

| Console | Real/Skeletal | In compose? | Wired to API | Rating |
|---|---|---|---|---|
| services/enstellar-portal | Real & mature (~4,059 LOC) | **YES (`web`)** | portal-bff `/bff/*` | 4/5 |
| ai-ops-console | Real | No | `/api/*` | 4/5 |
| provisioning-console | Real | No | control-plane + vkas | 4/5 |
| saas-admin | Real | No | control-plane `/v1/tenants*` | 3/5 |
| quality-console | Real (thin) | No | `/api/quality/*` | 3/5 |
| analytics-console | Real (thin) | No | `/api/analytics/*` | 3/5 |
| support-console | Real (thin) | No | control-plane | 2.5/5 |
| **reviewer-workspace** | **Dead shell** (no src/package.json) | No | none | 1/5 |

Only **enstellar-portal is deployed**. **Critical:** it ships with **no client-side auth** — sends no `Authorization` header, no Keycloak/OIDC/PKCE login flow, yet the BFF requires JWTs. The deployed UI cannot authenticate to its protected BFF.

### Security / auth verdict
Auth is **real in code but unevenly wired**. Real: RS256/JWKS validation (issuer+audience, rejects missing-`aud`); Spring resource server in interop; OPA enforced by workflow-engine + automation. **But:** audience validation **config-disabled** for Python services (no `*_OIDC_AUDIENCE` set → `verify_aud=False`); **no SMART scope enforcement** on FHIR; **unauthenticated/spoofable write paths** (`POST /cases/*/transitions|human-signoff|escalate` trust body `tenant_id`; automation `/dispositions` via raw `x-sim-*` headers); coarse single-role BFF RBAC (adverse `clinician_id` from request body, `TODO(compliance)`); **no TLS/mTLS** (`sslRequired:none`, MinIO/OpenSearch security off); hardcoded dev secrets + a **committed `.env`**, no secret manager.

### Conformance verdict — *present-but-not-run (and broken)*
A real Ruby Inferno harness exists (loads US Core + Da Vinci PAS test kits) but is **not a compose service and never invoked**. `conformance.yml` is schedule/dispatch-only (never gates PRs) and calls a **non-existent npm package** (would fail). The genuine IG-load/CRD/DTR ITs are `@Tag("integration")` and **excluded from CI**. No FHIR conformance harness runs or passes in CI.

### CI verdict
`ci.yml` gates: verify (lint/typecheck/unit + RLS harness), contracts (codegen + breaking-change), security (Anchore/TruffleHog/CodeQL), java-libs, enstellar-python (`-m "not integration"`), enstellar-interop (`excludeTags("integration")`). **Not in CI:** the smoke, `integration/e2e`, all integration-tagged ITs. **No coverage thresholds. No deploy pipeline** (`build-images.yml` pushes 17 images but omits `interop`; no helm/ArgoCD step).

### Convergence verdict
`simintero/services/enstellar-*` is a **vendored fork** of `Enstellar/services/*` (two independent git repos; compose never references `../Enstellar`). **`simintero` is authoritative and ahead** (2026-06-19 vs Enstellar 2026-06-14). Divergence is moderate-to-heavy and one-directional (rewires onto simintero substrate): ~49 differing workflow files + 13 sim-only additions, portal-bff 25, interop/src 21, connectors 13, **plus a duplicated `canonical-model` and a twice-implemented Revital surface (TS `revital-pipeline` vs Python `agent-layer`)**. **~100+ forked files, no sync mechanism.** The `Enstellar/` tree should be formally retired/archived.

### Observability — largely absent
**No OpenTelemetry, Prometheus, or tracing/log aggregation** (zero deps anywhere). Partial structured logging (Python/Java); ad-hoc TS logging. ~22 health endpoints (good liveness). Only domain-specific replay (`HistoricalReplayer`, support-console bundle); no platform DLQ replay. **The least-developed cross-cutting layer — health-checked but blind.**

---

## 7. Top systemic blockers to production (ranked)

1. **Substrate event plane is dead** — TS outbox nothing drains; relay on a different DB. Choreography only works inside Enstellar's self-contained Python service.
2. **Tenant isolation unproven & VKAS bypasses it** — RLS harness runs as superuser on un-migrated schema; VKAS sets no GUC; all substrate tests mock pg.
3. **Digicore governance store is in-memory** — approval ledger/audit evaporate on restart; unacceptable for regulated policy.
4. **Digicore decisioning is boolean-criteria, not CQL-vs-FHIR** — can't express real clinical policy.
5. **Revital AI is mock-only** — no real OCR/extraction/terminology/eval; can't do clinical document review.
6. **Qualitron has no real measure engine** and the Digicore-logic-source claim is false; reporting/aggregation undeployed.
7. **Deployed UI cannot authenticate; multiple write paths unauthenticated/spoofable; audience validation disabled.**
8. **FHIR conformance never runs; integration proof never runs in CI** — for a standards-conformance product.
9. **No observability, no TLS, no secrets management, no deploy pipeline.**
10. **Enstellar appeals absent; SLA breach monitoring not live; notifications miss adverse cases.**

## 8. What's genuinely solid vs demo

- **Solid / near-production:** Enstellar PAS+X12+case-model+auto-approval spine; the dual-gated human-sign-off; Digicore's CQL compiler + deterministic fail-safe evaluator + VKAS versioning; the RLS *schema design*; Revital's grounding/abstention/governance rails; the model-gateway inference path.
- **Demo-depth (proven path narrow):** Qualitron measure run; Revital end-to-end (zero docs submitted); Digicore rule-authoring lifecycle (in-memory store).
- **Scaffold / absent:** Appeals; Digicore DTR/licensed/registry/simulation/rollback; Revital OCR/real-AI/eval-ops; Qualitron reporting/aggregation/submission/Digicore-sourced logic; conformance-in-CI; observability; edge auth; deploy pipeline.

**Net:** Enstellar is closest to GA (a focused hardening pass from deployable on the PA path). Digicore has a strong core needing a durable governance store + richer evaluation. Revital and Qualitron are architecturally sound scaffolds whose core value (real grounded AI; real digital-measure evaluation) is not yet built. The platform is a **well-integrated prototype with one excellent product spine**, gated to production not by missing features alone but by unproven/unwired foundations (event plane, tenant-isolation proof, edge auth, conformance, observability).
