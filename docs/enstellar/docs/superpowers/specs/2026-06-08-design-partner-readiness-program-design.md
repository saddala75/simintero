# Design-Partner Readiness — Program Design

**Status:** Approved shape (2026-06-08). Program-level roadmap. Each sub-project below gets its own detailed spec → plan → implementation cycle. This document is the umbrella that defines scope, decomposition, sequencing, and done-criteria.

**Goal:** Meet the documented **P1 exit criteria** so a UM team can run **real prior authorization end-to-end (minus appeals) for a design partner** — supporting **both** PA entry paths (direct FHIR PAS `$submit` + X12 278, *and* EHR-integrated CRD → DTR → PAS).

## Scope decisions (locked 2026-06-08)

| Decision | Choice | Consequence |
|---|---|---|
| Deployment target | **Containerized compose on a VM** | Defer `helm`/`terraform`; package everything as docker-compose for a single managed host. |
| Hosting | **We host the pilot** | We own deploy + security posture; partner connects in. No partner-side install/runbook burden yet. |
| Integration connectors | **Mocks for the pilot** | Digicore/Revital stay on the in-repo mocks; `core-admin`/`terminology` real clients are out of scope for the pilot. Pilot exercises the flow, not real adjudication/summarization backends. |
| PA entry paths | **Both required at go-live** | Direct PAS/X12 (already built) **and** EHR-integrated CRD → DTR → PAS (greenfield). CRD + DTR are the dominant build. |

## Readiness bar (from the repo)

P1 exit criteria (`.claude/task-graph.md:38-43`, `docs/enstellar_design.md:60`):
1. Full lifecycle configurable without code changes — **already met** (existing config-driven state machine).
2. No-autonomous-adverse test suite green — **already met** (transition guard + tests).
3. Agent evals pass gates — **sub-project 7**.
4. X12 278 round-trip conformance — **largely met** (x12-translator round-trip tests); confirm depth in sub-project 4/6.
5. A UM team can run real PA end-to-end (minus appeals) — **sub-projects 1, 2, 3, 6**.

Prerequisite from P0 (`.claude/task-graph.md:21-25`): US Core + PAS **conformance smoke green in CI** — **sub-project 4**.

## Non-negotiable invariants (carry through every sub-project)

Per `CLAUDE.md`: no autonomous adverse determinations; no LLM on the decision path (CRD/DTR AI output is advisory and must pass the guardrail engine); PHI minimum-necessary and no new cross-boundary path; standards conformance via pinned IGs with generated (not hand-edited) artifacts; every call/event/log is tenant-scoped with provenance. CRD and DTR are **advisory** surfaces — they inform ordering and documentation; they never issue a determination.

## Sub-projects

Each has: scope, definition of done (DoD), dependencies, and the exit criterion it serves. Size: S/M/L.

### 1. Deployability foundation — M  *(unblocks all)*
- **Scope:** Multi-stage `Dockerfile` for the interop JVM app (boot jar → slim JRE), and for each Python service (`workflow-engine`, `agent-layer`, `portal-bff`, `integration-connectors` mocks already have them) and `apps/web`. Wire all real services into `infra/compose/docker-compose.yml` (today compose runs vanilla HAPI and Python runs on the host). One-command bring-up on a VM; per-service healthchecks; config/secrets via env + a documented `.env`; the `interop` service set to `HAPI_PROXY_ENABLED=true` pointing at the `hapi` container.
- **DoD:** `make up` on a clean VM brings the entire real stack healthy; a smoke request hits `interop` → proxies to HAPI; web loads against the real BFF. No service runs on the host.
- **Depends on:** none.
- **Serves:** prerequisite for criteria 5 and sub-projects 4 and 6.

### 2. CRD service (Coverage Requirements Discovery) — L
- **Scope:** CDS Hooks discovery endpoint + `order-sign` and `order-select` hooks (and `appointment-book` if needed) returning coverage-requirement **cards** (auth required? documentation needed? alternatives?). Da Vinci CRD profiles (pinned IG). Tenant-scoped, advisory only, guardrail-gated; any AI assist passes the guardrail engine and never decides coverage.
- **DoD:** CDS Hooks discovery lists the hooks; a sample EHR hook request returns conformant cards; cards can point the user into DTR; unit + IT tests; no PHI logged in the clear.
- **Depends on:** 1 (deployable), shares canonical model + interop FHIR tier.
- **Serves:** EHR-integrated path (criterion 5).

### 3. DTR service (Documentation Templates & Rules) — L
- **Scope:** FHIR `Questionnaire` retrieval + `QuestionnaireResponse` capture; **CQL-based prepopulation** from FHIR data; SMART app launch (or service-rendered questionnaire) so a provider can complete documentation; hand-off of the completed QuestionnaireResponse into the PAS `$submit` bundle. Da Vinci DTR profiles (pinned IG).
- **DoD:** a Questionnaire renders, prepopulates via CQL from test FHIR data, captures a QuestionnaireResponse, and feeds a valid PAS submission; unit + IT tests; PHI minimization honored.
- **Depends on:** 1; integrates with 2 (CRD card → DTR launch) and the existing PAS service.
- **Serves:** EHR-integrated path (criterion 5).

### 4. Conformance CI gate (Inferno) — M
- **Scope:** Use the descoped Task-10 follow-up (`docs/superpowers/specs/2026-06-08-conformance-ci-followup-design.md`) — interop container (from sub-project 1) + a **custom Inferno image** built with the US Core 5.0.1 + Da Vinci PAS 2.0.1 test-kit gems; real `make conformance`; CI job uploading results; `ConformanceTestAuthFilter` static token via the conformance compose override. Add CRD/DTR test kits once sub-projects 2/3 land. Resolve the `proxy-enabled` production default (flip to `true` or fail-fast).
- **DoD:** `make conformance` runs the US Core + PAS suites against the running `interop` and exits non-zero on failure; CI gate green; results archived as artifacts.
- **Depends on:** 1 (interop container). CRD/DTR conformance depends on 2/3.
- **Serves:** P0 conformance-smoke prerequisite.

### 5. Security & supply-chain gate — S–M
- **Scope:** Replace the stub `make scan` with real **SAST** (Semgrep), **secret scanning** (gitleaks), and **dependency/vuln scanning** across all three stacks (Trivy or OWASP dependency-check for JVM, `pip-audit` for Python, `npm audit`/Trivy for JS). Wire as a CI gate with sane severity thresholds and an allowlist mechanism.
- **DoD:** `make scan` runs all three classes locally and in CI, fails on high-severity findings, and has a documented suppression path; baseline triaged.
- **Depends on:** none hard (can start immediately); benefits from 1 for image scanning.
- **Serves:** payer security posture / invariant #4 stance.

### 6. End-to-end test — M
- **Scope:** Real `make e2e` exercising **both** paths against the deployed stack: (a) CRD → DTR → PAS `$submit` → workflow → auto-approve decision → ClaimResponse; (b) direct PAS/X12 278 → same downstream. Assert the trace/decision recorder and comms fire. Cross JVM↔Python↔UI.
- **DoD:** `make e2e` brings up the stack, runs both scenarios green, and is wired into CI (or a nightly job if too heavy for PR CI).
- **Depends on:** 1, 2, 3 (both paths), and the existing workflow/decision/comms tiers.
- **Serves:** criterion 5 (run real PA end-to-end).

### 7. Agent evals vs the real model — S–M
- **Scope:** Run the existing eval harness (thresholds: groundedness ≥0.8, gap precision ≥0.75, abstention ≥0.6) against the **configured production model** (Claude commercial via the model-access port; optionally the open-weight local model) on a **curated held-out PA dataset**, instead of the current stub model. Wire as a gate.
- **DoD:** evals run against the real model on the held-out set, meet thresholds, and gate in CI (or nightly); dataset and run are reproducible and PHI-safe.
- **Depends on:** model-access config; benefits from 1.
- **Serves:** criterion 3 (agent evals pass gates).

## Sequencing

```
1 Deployability ──┬──> 2 CRD ──┐
                  ├──> 3 DTR ──┼──> 6 E2E (both paths)
                  ├──> 4 Conformance gate (US Core+PAS now; CRD/DTR after 2,3)
                  └──> 7 Agent evals
5 Security gate ── (parallel, can start now)
```
Critical path runs through **1 → (2,3) → 6**. Gates (4, 5, 7) run alongside. Build sub-project **1 first**; its detailed plan is produced next.

## Baked-in defaults (override if desired)
- Conformance covers **US Core 5.0.1 + PAS 2.0.1** first; CRD/DTR conformance added as those services land.
- `make scan` = **Semgrep** (SAST) + **gitleaks** (secrets) + **Trivy / OWASP dependency-check / pip-audit / npm audit** (deps).
- Agent evals run against the **configured Claude model** on a curated held-out PA case set.
- Pinned Da Vinci IG versions for CRD/DTR to be confirmed in their sub-project specs (align with the PAS 2.0.1 era).

## Out of scope (this program)
- Appeals/grievances (roadmap P2), CMS Access APIs (P3), and adjacent features (P4).
- Real Digicore/Revital/core-admin/terminology backends (mocks for the pilot).
- `helm`/`terraform` / Kubernetes (compose-on-VM for the pilot).
- Partner-side self-hosting packaging (we host).

## Open decisions for sub-project specs
1. `interop.hapi.proxy-enabled` production default — flip to `true` vs fail-fast startup check (resolve in sub-project 4).
2. DTR delivery: full SMART app vs server-rendered questionnaire for the pilot.
3. Whether E2E runs on every PR or nightly (cost/runtime).
4. Pinned Da Vinci CRD/DTR IG versions and the matching Inferno test kits.

## Sub-project 1 (Deployability) — DONE, with hardening follow-ups
Implemented and verified on branch `deployability-foundation` (2026-06-08): all five first-party
services containerized and wired into compose; clean `make down`+`make up` reaches all-healthy
from scratch; `make smoke` passes. Final-review hardening items deferred (pilot-acceptable, not
blocking the smoke DoD) — fold into a later hardening pass or the relevant sub-project:
- **Non-root for the Python + web images** (only interop runs non-root today). Security posture for a hosted pilot.
- **Pin base images by digest** (currently floating tags: python:3.12-slim, node:22-alpine, nginx:1.27-alpine, gradle:8.7-jdk21, eclipse-temurin:21-jre) for reproducible/auditable builds.
- **Keycloak issuer alignment** — browser tokens are issued by `localhost:8081` but interop/bff validate `iss=http://keycloak:8080/...`; real authenticated PA flows will 401 until the realm `frontendUrl`/issuer is aligned. Not exercised by the health-only smoke; must be resolved for the e2e sub-project (#6).
- **Minor:** migrations run on every workflow-engine start (fine single-replica; make a one-shot job before scaling); `make smoke` web port doesn't read `infra/compose/.env`; consider COPYing healthcheck.jar into the interop image instead of bind-mounting.
