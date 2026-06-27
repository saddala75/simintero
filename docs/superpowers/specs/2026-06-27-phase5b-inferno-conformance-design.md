# Phase 5B — Inferno FHIR Conformance Design

## Goal

Wire all five Da Vinci Inferno test suites (US Core, SMART App Launch, PAS, CRD, DTR) as a gating CI check on every PR to `main`, and fix the known CapabilityStatement gaps that cause those suites to fail immediately.

## Current state

- `enstellar-interop` is the unified FHIR gateway (Spring Boot + HAPI FHIR R4, port 8080).
- It handles `Claim/$submit`, `Claim/$inquire` (PAS), CDS Hooks (CRD), DTR questionnaire launch, and proxies everything else to the upstream HAPI JPA store.
- `.github/workflows/conformance.yml` runs US Core + SMART App Launch via a placeholder `npx inferno-program-suite` command, **weekly only**, and does not cover Da Vinci PAS/CRD/DTR.
- `CapabilityStatementIT` asserts the metadata endpoint returns a statement with exactly 5 resource types (Patient, Practitioner, Coverage, Organization, DocumentReference). It does **not** assert `Claim`, `$submit`/`$inquire` operations, or `implementationGuide` declarations — all of which the Da Vinci Inferno suites check first.
- `FhirCapabilityProperties` (loaded from `application.yml`) is never injected anywhere — it is dead code.
- `ConformanceTestAuthFilter` already exists and bypasses JWT when `interop.conformance-test-mode=true` and the request carries the expected static bearer token.

## Architecture

Three independent pieces:

1. **CapabilityStatement augmenter** — a HAPI interceptor that post-processes `/fhir/metadata` responses to declare the missing operations, profiles, and IGs.
2. **docker-compose conformance profile** — five Inferno test kit containers, gated behind `--profile conformance` so normal `docker compose up` is unaffected.
3. **CI script + workflow update** — `scripts/run-inferno-suites.sh` drives each kit via its REST API; `conformance.yml` adds a `pull_request` trigger and calls the script.

## Section 1: CapabilityStatement augmenter

### Why the gap exists

HAPI's `RestfulServer` auto-generates a CapabilityStatement from its registered providers (`PasClaimSubmitProvider`, `PasClaimInquireProvider`, etc.). The `/fhir/metadata` response proxied through `FhirProxyFilter` comes from the upstream HAPI JPA store, which knows about resource CRUD but not about the interop-layer operations. Neither path declares `implementationGuide` references or Da Vinci profiles on resource types.

### Fix

Add `CapabilityStatementAugmenter` — a HAPI `IServerInterceptor` registered on the `RestfulServer` — that intercepts outgoing capability statements and augments them.

**New file:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/config/CapabilityStatementAugmenter.java`

```java
@Component
public class CapabilityStatementAugmenter implements IServerInterceptor {
    // Hook: SERVER_OUTGOING_RESPONSE → check if response is CapabilityStatement
    // then:
    // 1. Set cs.publisher = "Simintero Enstellar"
    // 2. Add implementationGuide references (see below)
    // 3. Add/update resource entries for Claim, ClaimResponse, Questionnaire, QuestionnaireResponse
    // 4. Add $submit and $inquire operation declarations on the Claim resource entry
}
```

`implementationGuide` canonical URLs to add:
- `http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core|5.0.1`
- `http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas|2.0.1`
- `http://hl7.org/fhir/us/davinci-crd/ImplementationGuide/hl7.fhir.us.davinci-crd|2.0.1`
- `http://hl7.org/fhir/us/davinci-dtr/ImplementationGuide/hl7.fhir.us.davinci-dtr|2.0.0`

Resource entries to add/augment:

| Type | Profile | Operations |
|------|---------|-----------|
| `Claim` | `http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas\|2.0.1` | `$submit`, `$inquire` |
| `ClaimResponse` | `http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claimresponse-pas\|2.0.1` | — |
| `Questionnaire` | `http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaire\|2.0.0` | — |
| `QuestionnaireResponse` | `http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse\|2.0.0` | — |

**Wiring:** `HapiServerConfig.fhirServer()` calls `server.getInterceptorService().registerInterceptor(augmenter)`.

**`FhirCapabilityProperties`:** retire the dead YAML block (`enstellar.fhir.capability.resources`) and delete the now-unused `FhirCapabilityProperties` class. The augmenter owns the declarations directly, which avoids a runtime binding that nobody was enforcing.

**`CapabilityStatementIT` additions:**

```java
@Test
void metadata_declares_claim_resource_with_pas_operations() { ... }
// asserts: "Claim" present in resources, "operation" array contains "$submit" and "$inquire"

@Test
void metadata_declares_implementation_guides() { ... }
// asserts: implementationGuide array contains the four canonical URLs above

@Test
void metadata_declares_required_resource_types() { ... }
// update expected set: add "Claim", "ClaimResponse", "Questionnaire", "QuestionnaireResponse"
```

## Section 2: docker-compose conformance profile

Five Inferno test kit containers, each under `profiles: [conformance]`:

| Service | Image | Host port | Notes |
|---------|-------|-----------|-------|
| `inferno-us-core` | `ghcr.io/inferno-community/us-core-test-kit:latest` | 4545 | US Core 5.0.1 |
| `inferno-smart` | `ghcr.io/inferno-community/smart-app-launch-test-kit:latest` | 4546 | SMART App Launch 2.0 |
| `inferno-pas` | `ghcr.io/inferno-framework/davinci-pas-test-kit:latest` | 4547 | Da Vinci PAS 2.0.1 |
| `inferno-crd` | `ghcr.io/inferno-framework/davinci-crd-test-kit:latest` | 4548 | Da Vinci CRD 2.0.1 |
| `inferno-dtr` | `ghcr.io/inferno-framework/davinci-dtr-test-kit:latest` | 4549 | Da Vinci DTR 2.0.0 |

Each container:
- `environment: FHIR_SERVER_URL: http://interop:8080/fhir` (pre-populates the "server under test" input)
- `depends_on: interop: condition: service_healthy`
- `networks: [sim-net]`
- `healthcheck`: `GET http://localhost:XXXX/` returns 200 (Inferno's root UI page)

**Conformance test mode for `interop`:** Add to the `interop` service block:
```yaml
environment:
  INTEROP_CONFORMANCE_TEST_MODE: "${INTEROP_CONFORMANCE_TEST_MODE:-false}"
  INTEROP_CONFORMANCE_TEST_TOKEN: "${INTEROP_CONFORMANCE_TEST_TOKEN:-conformance-test-token}"
```

CI sets `INTEROP_CONFORMANCE_TEST_MODE=true` before running docker compose. Default `false` means the flag is inert in normal dev use.

**Note on image tags:** The exact image coordinates and Inferno suite IDs (`us_core_v501`, `davinci_pas_v201`, etc.) must be confirmed by pulling each image and calling `GET /api/test_suites` on startup. The implementer must verify these before hardcoding them into the CI script.

**SMART suite:** Uses conformance bypass (same static token) for Phase 5B. Automating the full SMART OAuth flow in CI requires a registered OIDC client + redirect-URI handling and is out of scope here. The SMART App Launch Inferno suite will test SMART discovery and token-endpoint declarations; the interactive auth steps will be skipped or reported as skipped, not failed.

## Section 3: CI script + conformance.yml

### `scripts/run-inferno-suites.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Inferno REST API: create session → run → poll → report.
# Exit code: number of failing suites (0 = all pass).

FHIR_URL="${FHIR_URL:-http://localhost:8080/fhir}"
TOKEN="${INFERNO_CONFORMANCE_TOKEN:-conformance-test-token}"
FAILURES=0

run_suite() {
  local NAME="$1" BASE_URL="$2" SUITE_ID="$3"

  # Create session with FHIR URL + static bearer token for conformance test mode.
  local SESSION_ID
  SESSION_ID=$(curl -sf -X POST "$BASE_URL/api/test_sessions" \
    -H "Content-Type: application/json" \
    -d "{\"test_suite_id\":\"$SUITE_ID\",
         \"inputs\":[{\"name\":\"url\",\"value\":\"$FHIR_URL\"},
                     {\"name\":\"additional_headers\",\"value\":\"Authorization: Bearer $TOKEN\"}]}" \
    | jq -r '.id')

  # Start run
  curl -sf -X POST "$BASE_URL/api/test_sessions/$SESSION_ID/run" > /dev/null

  # Poll until not "running" (5 min timeout)
  local RESULT="running" i=0
  while [[ "$RESULT" == "running" && $i -lt 60 ]]; do
    sleep 5; i=$((i+1))
    RESULT=$(curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID" | jq -r '.result')
  done

  echo "[$NAME] $RESULT"
  if [[ "$RESULT" != "pass" ]]; then
    # Print failed test names for CI log visibility
    curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID/results" \
      | jq -r '.[] | select(.result == "fail") | .title' | sed "s/^/  FAIL: /"
    FAILURES=$((FAILURES+1))
  fi
}

# Suite IDs below must match what each kit reports on GET /api/test_suites.
run_suite "us-core" "http://localhost:4545" "us_core_v501"
run_suite "smart"   "http://localhost:4546" "smart_app_launch"
run_suite "pas"     "http://localhost:4547" "davinci_pas_v201"
run_suite "crd"     "http://localhost:4548" "davinci_crd"
run_suite "dtr"     "http://localhost:4549" "davinci_dtr"

echo ""
echo "$FAILURES suite(s) failed."
exit $FAILURES
```

### `conformance.yml` update

```yaml
on:
  pull_request:
    branches: [main]          # ← NEW: gates every PR
  schedule:
    - cron: "0 4 * * 1"       # kept: weekly full run
  workflow_dispatch:

env:
  INTEROP_CONFORMANCE_TEST_MODE: "true"
  INTEROP_CONFORMANCE_TEST_TOKEN: "conformance-test-token"

jobs:
  fhir-conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Bring up interop + Inferno kits
        run: |
          docker compose --profile conformance up -d --wait \
            postgres keycloak hapi redpanda minio digicore-runtime interop \
            inferno-us-core inferno-smart inferno-pas inferno-crd inferno-dtr
      - name: Run Inferno suites
        run: bash scripts/run-inferno-suites.sh
      - name: Tear down
        if: always()
        run: docker compose --profile conformance down -v
```

The old `pnpm install` + `npx inferno-program-suite` steps are removed entirely — the script drives Inferno via its REST API with no Node.js tooling needed.

## Data flow

```
PR opened → conformance.yml (pull_request trigger)
  → docker compose --profile conformance up
  → 5 Inferno containers + interop (conformance-test-mode=true) start
  → run-inferno-suites.sh:
      POST /api/test_sessions (create) × 5
      POST /api/test_sessions/:id/run × 5
      GET  /api/test_sessions/:id (poll until done) × 5
      Inferno → POST /fhir/... (with Bearer conformance-test-token)
      ConformanceTestAuthFilter: token matches → bypass JWT → set conformance-test tenant
      Interop handles request, returns FHIR response
      Inferno validates response against IG profile
  → exit 0 if all pass / exit N if N suites fail
  → PR blocked if exit != 0
```

## Out of scope for Phase 5B

- CMS-0053-F X12 / C-CDA conformance (Phase 4 scope)
- Fixing all runtime Inferno failures — Phase 5B ships the infrastructure and fixes known structural gaps (CapabilityStatement). Remaining failures are tracked as issues, not blockers.
- Inferno as a persistent local dev service (devs run `docker compose --profile conformance up` when they need it)

## Exit criteria

1. `CapabilityStatementIT` passes with the new resource type assertions (Claim + ops + IGs).
2. Five Inferno containers are present in `docker-compose.yml` under the `conformance` profile and start healthy against the interop service.
3. `scripts/run-inferno-suites.sh` runs without error (suites may report failures; the script itself must not crash).
4. `conformance.yml` triggers on `pull_request` targeting `main` and calls the script.
5. No regression in existing interop ITs (`PasSubmitIT`, `PasInquireIT`, `CdsServicesIT`, `DtrLaunchIT`, `SmartAuthIT`).
