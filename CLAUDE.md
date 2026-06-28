# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Knowledge graph

A graphify knowledge graph of this codebase lives at `graphify-out/graph.json` (5,902 nodes, 10,485 edges, 461 communities). **Before exploring unfamiliar code, run `/graphify query "<question>"` to orient yourself — it is faster than grepping cold.** Key facts the graph surfaced:

- `make_case()` (`services/enstellar-workflow/tests/conftest.py:L130`) has 100 edges and bridges 12 test communities. It has hardcoded `lob="commercial"` — tests for LOB-aware behavior must override it explicitly.
- `OutboxPublisher` (63 edges) is the event spine; every state change routes through it.
- `tenant_transaction()` is called directly from workflow API routers — the platform DB wrapper is load-bearing in the hot path.
- The `Case → CaseService → TransitionEngine → DecisionRecord → OutboxPublisher` chain is the full prior-authorization decision path.
- Update the graph after significant changes: `/graphify ./services ./modules ./infra ./apps ./platform ./integration --update`

## What this repo is

`simintero` is the single authoritative monorepo for the Simintero payer platform and four products:
- **Enstellar** — utilization management / prior authorization (FHIR PAS / X12 interop)
- **Digicore** — clinical rules authoring, governance, and runtime engine
- **Revital** — data extraction and enrichment pipeline
- **Qualitron** — quality measure execution and gap reporting

## Commands

### Workspace (TypeScript/Node)
```bash
pnpm build              # build all TS packages (turbo)
pnpm verify             # lint + typecheck + unit tests (run before any PR)
pnpm rls-harness        # cross-tenant RLS probe suite
pnpm contracts:check    # contract breaking-change check
pnpm contracts:generate # regenerate inter-module contract clients

# Single package (use --filter with the @sim/* package name)
pnpm --filter @sim/claims-service test
pnpm --filter @sim/claims-service typecheck
pnpm --filter @sim/vkas test -- --reporter=verbose
```

### Python workspace (uv)
```bash
uv run pytest services/enstellar-workflow/tests/
uv run pytest services/enstellar-workflow/tests/test_foo.py::test_bar  # single test
uv run pytest services/enstellar-portal-bff/tests/
uv run pytest platform/conformance-kit/
```

### Local stack
```bash
make up    # docker compose up -d --wait (Postgres, Redpanda, Keycloak, MinIO, OPA, all services)
make down  # docker compose down -v
make smoke # smoke-test the unified stack
```

### Portal (React)
```bash
cd services/enstellar-portal && pnpm dev   # Vite dev server → http://localhost:5173
```

## Architecture

### Directory layout
```
modules/          Business domain modules — each module is isolated
  analytics/      Margin snapshots
  automation/     Disposition automation
  claims/         Claim + appeal lifecycle
  digicore/       Clinical rule authoring, governance, registry, runtime, simulation
  market-bundles/ Bundle configuration
  qualitron/      Quality measure execution, gaps, aggregation, reporting
  revital/        Data extraction + enrichment pipeline
  search/         Indexer + query API

platform/         Shared infrastructure — no module code here
  libs/           Cross-cutting libraries (each has ts/, py/, java/ sub-packages)
    tenant-context  db() wrapper + ctx() accessor; sets sim.tenant_id GUC
    outbox          Transactional outbox (append() + idempotent consumer dedup)
    authz-client    OPA client
    audit-client    PHI-aware typed logger
    fhir-mapping    Wire-format mapping (FHIR ↔ canonical)
  services/
    vkas            Version-controlled Knowledge Artifact Store
    model-gateway   LLM proxy with PHI filter + kill-switch
    rls-harness     Cross-tenant RLS test suite (manifest.json lists covered tables)
    db-migrations   Flyway SQL migrations (V*.sql under migrations/)
    opa-policies    Rego authorization policies
    terminology-service, task-service, relay, control-plane, document, mock-llm

services/         Enstellar product services (built + run by docker-compose.yml)
  enstellar-workflow    Python/FastAPI — UM case state machine, event plane
  enstellar-portal-bff  Python/FastAPI — reviewer BFF (JWT validation, proxies to workflow)
  enstellar-portal      React/Vite — reviewer UI
  enstellar-connectors  Python — integration connectors (clearinghouse, Revital, Digicore)
  enstellar-interop     Java — FHIR PAS / X12 adapter
  enstellar-compose     Docker healthcheck jar

contracts/        Canonical event/domain model
  schemas/        JSON Schema source (canonical/, events/, envelope/)
  generated/      TypeScript + Python + Java output — DO NOT edit by hand
  codegen/        Generator scripts

apps/web/         Additional frontend consoles
  ai-ops-console, analytics-console, quality-console, provisioning-console, etc.

integration/      E2E tests, FHIR facade, connectors
artifacts/        Synthetic test data
infra/            Postgres init SQL, Keycloak realm config
```

### Key architectural patterns

**Contract-first inter-module communication.** `modules/` packages never import each other directly. All cross-module calls use generated clients from `@sim/contracts`. After any schema change run `pnpm contracts:generate`.

**Multi-tenancy via RLS.** Every DB query must go through `db()` from `platform/libs/tenant-context`. This sets the `sim.tenant_id` GUC that drives PostgreSQL row-level security. New tables require all four RLS steps (see rules below) and must be added to `platform/services/rls-harness/manifest.json`.

**VKAS for tenant/LOB/state variation.** Any behavior that differs by tenant, line of business, or state is a VKAS artifact + engine call — never a code branch. `@sim/vkas` (`platform/services/vkas`) manages lifecycle: draft → approved → active → archived.

**Outbox for events.** All state changes emit through `outbox.append()` (`platform/libs/outbox`). Consumers must be idempotent on `event_id` using the dedup pattern in that same library.

**PHI safety.** Use the typed logger from `platform/libs/audit-client`; fields tagged `@phi` are auto-tokenized. Never interpolate request bodies or stringify clinical objects into logs.

**Model gateway.** LLM calls route through `platform/services/model-gateway` which enforces PHI filtering and per-tenant kill-switches. Never call LLM providers directly from module code.

## STOP — read this before writing any code

### Cross-module rules
- NEVER import from `modules/A` inside `modules/B`. Use generated contract clients only.
- NEVER import from `modules/*` inside `platform/*`.
- Wire formats (FHIR classes, X12) appear ONLY under `integration/` and `platform/libs/fhir-mapping`.
- Before any cross-module call, regenerate client: `pnpm contracts:generate`.

### Tenancy (NON-NEGOTIABLE)
- NEVER pass `tenant_id` as a plain function parameter across service boundaries.
- ALWAYS use `platform/libs/tenant-context` — `ctx()` accessor only.
- NEVER write a DB query without going through the `db()` wrapper in `platform/libs/tenant-context`.
  It sets `sim.tenant_id` GUC. A query without it will fail the RLS harness.

### New table checklist (do all four or the CI RLS harness will fail)
1. `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`
2. `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`
3. `CREATE POLICY tenant_isolation ON <t> USING (tenant_id = current_setting('sim.tenant_id', true))`
4. Add `<t>` to `platform/services/rls-harness/manifest.json`

### PHI rules
- NEVER interpolate request bodies or payload objects into log strings.
- Use the typed logger from `platform/libs/audit-client`. Fields tagged `@phi` are auto-tokenized.
- NEVER log a free-form JSON.stringify of any object that could contain clinical data.

### Events
- ALL state changes emit via `outbox.append()` from `platform/libs/outbox`.
- Event consumers MUST be idempotent on `event_id`. Use the dedup pattern in `platform/libs/outbox`.

### Adverse-action path (CRITICAL)
- Do NOT create any code path that calls `decision.record` with outcome `deny | partial_deny | modify`
  outside the guarded command handler in `modules/enstellar/case/commands/RecordDecision.ts`.
- If a task seems to require it: STOP immediately, write a `REVIEW_REQUIRED.md` at the repo root
  describing the code path found, and halt with status BLOCKED. Do not implement it.

### Artifacts over branches
- Behavior that varies by tenant, LOB, or state MUST be a VKAS artifact + engine call.
- If a PR adds `if (tenantId === 'x')`, the review MUST reject it.

### Verify before PR
```bash
pnpm verify          # lint + typecheck + unit tests
pnpm rls-harness     # cross-tenant probe suite
pnpm contracts:check # contract compatibility check
```
