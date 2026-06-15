# Conformance CI (Inferno) — Follow-up Design

**Status:** Design / not implemented. Supersedes Task 10 of `docs/superpowers/plans/2026-06-07-conformance-hardening.md`, which was found to be non-executable as written (see "Why the original Task 10 was descoped").

**Date:** 2026-06-08
**Owner:** TBD (requires senior review — touches FHIR conformance + infra/IaC, both mandatory-review areas per CLAUDE.md).

## Goal

Provide a `make conformance` target and a CI job that run the **Inferno** US Core 5.0.1 and Da Vinci PAS 2.0.1 test suites against the running `interop` service, as a gate on FHIR conformance.

## Context: what already shipped (Tasks 1–9)

The conformance-hardening *code* is done and on `main`:

- `FhirProxyFilter` proxies `/fhir/**` to the external HAPI container, injecting `meta.security` tenant tags on writes, appending `_security` on searches, and enforcing tenant ownership on reads; `$submit`/`$inquire` bypass the proxy to embedded HAPI operation providers.
- Custom FHIR storage (`fhir_resource` table + ResourceProviders) was removed; Flyway `V4` drops the table. HAPI (via the external container) now owns all FHIR CRUD.
- HAPI loads US Core 5.0.1 + Da Vinci PAS 2.0.1 IGs (compose env). `HapiIgLoadIT` (Testcontainers, `@Tag("integration")`) **verifies the IGs load and that profile validation rejects a non-conformant Patient** — this is real, locally-verified conformance evidence at the HAPI layer.
- All `services/interop` integration tests run against a shared WireMock HAPI with the proxy enabled; tenant-isolation tests assert the proxy's `_security` scoping (not just empty-bundle stubs).
- `interop.hapi.proxy-enabled` defaults to `false` in `application.yml` (production default deferred — see "Decisions required" #1); tests force it on via `FhirTestBase`.

What is **missing** and this spec covers: running the Inferno *suites* (HTTP-level conformance) against a deployed `interop` in CI.

## Why the original Task 10 was descoped

Verified directly against Docker on 2026-06-08:

1. **The planned Inferno image does not exist.** `infernoframework/inferno-core:latest` → `pull access denied … repository does not exist`. The `inferno` service in `infra/compose/docker-compose.yml` (added in Task 1, behind the `conformance` profile) therefore references a non-existent image.
2. **The real image is a web server, not a CLI.** `infernocommunity/inferno-core:latest` exists but its `CMD` is `bundle exec puma` (it serves the Inferno web app); there is no `inferno` executable on `PATH`, so the plan's `inferno suite run --suite … --url …` CLI invocation via `docker compose exec inferno …` cannot work as written.
3. **The stock image bundles no US Core / PAS test kits.** Its `Gemfile.lock` contains no `us_core_test_kit` / `davinci_pas_test_kit` gems — only demo/dev suites. Running those suites requires a **custom Inferno image** built with those gems.
4. **There is no `interop` container.** No `services/interop/Dockerfile` and no `interop` service in compose, yet `make conformance` targets `http://interop:8080/fhir`. Full `$submit`/`$inquire` conformance additionally needs the interop service's runtime deps (Postgres for `decision_store`, Kafka/Redpanda, MinIO, and a JWT issuer).

## Proposed approach

### 1. Containerize `interop`
- `services/interop/Dockerfile`: multi-stage — stage 1 builds the boot jar (`./gradlew bootJar`, using the fixed wrapper); stage 2 is a slim JRE 21 runtime. Expose 8080. Non-root user.
- Add an `interop` service to `infra/compose/docker-compose.yml`:
  - `depends_on`: `hapi` (healthy), `workflow-db`/a dedicated interop DB (healthy, for `decision_store`), `redpanda` (healthy), `minio` (healthy), `keycloak` (healthy, JWT issuer).
  - env: `HAPI_BASE_URL=http://hapi:8080/fhir`, `HAPI_PROXY_ENABLED=true`, datasource → interop DB, Kafka bootstrap → `redpanda:29092`, MinIO endpoint, OAuth2 resource-server issuer → Keycloak realm.
  - healthcheck on `/actuator/health`.
  - `expose: ["8080"]` (no host port needed; Inferno reaches it on the compose network).

### 2. Build a custom Inferno image with both test kits
- `infra/compose/inferno/Dockerfile`: `FROM infernocommunity/inferno-core:<pinned-digest>`; add a `Gemfile` overlay declaring `gem "us_core_test_kit"` (pinned to the 5.0.1-supporting version) and `gem "davinci_pas_test_kit"` (pinned to the 2.0.1-supporting version); `bundle install`; precompile suites. Pin to `linux/amd64` (Inferno publishes amd64 only — note for arm64 dev hosts, runs under emulation).
- Replace the `inferno` service image in compose with this custom build (`build:` context), and **re-add `depends_on: [interop]`** (removed in Task 1 because `interop` didn't exist yet).

### 3. Run the suites
Two viable mechanisms — pick one in review:
- **(a) CLI inside the custom image:** if the custom image exposes the `inferno` CLI (verify the gem provides the executable; may require `bundle exec inferno`), run `bundle exec inferno suite run --suite <id> --url http://interop:8080/fhir --options …`. Discover real suite IDs in the *custom* image via `bundle exec inferno suites`.
- **(b) HTTP API / runner:** drive the Inferno web app's test-session API to start a run and poll results. More moving parts; only if the CLI path is unavailable.

Real suite IDs **must be discovered from the custom image** (they depend on the test-kit gem versions); do not hard-code the placeholders from the original plan.

### 4. Auth for the conformance run
`ConformanceTestAuthFilter` (Task 3, property-guarded by `interop.conformance-test-mode=true`) provides a static bearer token so Inferno can authenticate without a full OAuth dance. Supply it via `infra/compose/docker-compose.conformance.yml`:
```yaml
services:
  interop:
    environment:
      INTEROP_CONFORMANCE_TEST_MODE: "true"
      INTEROP_CONFORMANCE_TEST_TOKEN: "conformance-test-token"
```
This override **must never** be applied in staging/prod.

### 5. `make conformance` + CI
- Makefile: `COMPOSE_CONFORMANCE := docker compose -f $(COMPOSE_FILE) -f infra/compose/docker-compose.conformance.yml`; bring up `--profile conformance --wait`; run the suite(s); write results to `/tmp/inferno-*.json`; non-zero exit on suite failure.
- CI job (`.github/workflows/ci.yml`): `needs: [test-interop]`, `make up` (or the conformance compose), `make conformance`, upload `/tmp/inferno-*.json` as an artifact, `make down` in `always()`.

## Decisions required (human review)

1. **Production default for `interop.hapi.proxy-enabled`.** Custom storage is gone, so the proxy is the *only* FHIR-CRUD path. The production `application.yml` default is still `false`; if a real deployment ships with it false, FHIR CRUD silently 404s on the embedded HAPI. Decide: flip the default to `true`, or require it be set explicitly per environment (and add a fail-fast startup check). Currently only the conformance compose service sets it true via env.
2. **Test-kit gem versions / suite IDs** — must be pinned to versions that target US Core 5.0.1 and PAS 2.0.1, then the suite IDs read from the built image.
3. **Inferno run mechanism** — CLI (3a) vs HTTP API (3b).
4. **interop's datastore in compose** — reuse `workflow-db` or add a dedicated `interop-db`.

## Out of scope / known follow-ups
- Fix the stale `infernoframework/inferno-core` reference in `infra/compose/docker-compose.yml` (will be replaced by the custom-image build above).
- The `gradlew` arg-forwarding bug was already fixed (`b53fed4`); note that multi-project test filtering must be scoped to the root task, e.g. `./gradlew :test --tests "<pattern>"` (an unscoped `test --tests` fails on the `x12-translator` subproject with "No tests found").
- `PasSubmitIT.submit_validBundle_returns200WithApprovedClaimResponse` is a pre-existing Kafka/Redpanda-timing flake, independent of this work.
