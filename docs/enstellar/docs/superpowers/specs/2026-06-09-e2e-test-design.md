# SP6: End-to-End Test — Design Spec

**Status:** Approved (2026-06-09). Implements SP6 of the design-partner readiness program.

**Goal:** A real `make e2e` that exercises both PA entry paths against the deployed stack — asserting the full lifecycle through auto-approval to a retrievable ClaimResponse — and runs nightly in CI.

**Serves:** P1 exit criterion 5 — a UM team can run real PA end-to-end (minus appeals) for a design partner.

---

## 1. Overall Architecture

`make e2e` is a sequential pipeline:

```
make e2e-seed          # POST FHIR fixtures to HAPI + create PA case; write fixture-manifest.json
pytest tests/e2e/      # path B: direct PAS/X12 278 — httpx + workflow polling
playwright (path A)    # path A: CRD→DTR browser flow — real stack, real auth
make e2e-teardown      # DELETE seeded FHIR resources (trap ensures it runs on failure)
```

**Two test suites, one orchestrating target:**

- **`tests/e2e/`** (new Python package at repo root) — owns path B and shared assertion helpers (workflow state polling, ClaimResponse fetch, token acquisition). Reads `infra/compose/e2e-fixture-manifest.json` for resource IDs.

- **`apps/web/e2e/real-stack/`** (new Playwright suite under the existing web e2e dir) — owns path A browser flow against the real compose stack. Reads the same manifest. Activated via `PLAYWRIGHT_REAL_STACK=1`.

**CI trigger:** Nightly only (both suites are too heavy for PR CI). Results archived as artifacts (pytest JSON + Playwright HTML report, 30-day retention).

---

## 2. Keycloak Issuer Fix

**Root cause:** Keycloak issues tokens with `iss` matching the request origin — `http://localhost:8081/realms/enstellar` from a browser — but interop currently validates `iss` against the internal docker hostname `http://keycloak:8080/realms/enstellar`. This causes 401s on all real authenticated flows.

**Fix: three config changes, no new Java code.**

### 2a. Keycloak — fix frontend URL

In `infra/compose/docker-compose.yml`, add to the `keycloak` service environment:

```yaml
KC_HOSTNAME_URL: http://localhost:8081
```

This pins the token `iss` claim to `http://localhost:8081/realms/enstellar` regardless of which network leg (browser or internal service) triggered the token issuance.

### 2b. Interop — align issuer URI

In `infra/compose/docker-compose.yml`, update the `interop` service environment:

```yaml
# was: KEYCLOAK_ISSUER_URI: http://keycloak:8080/realms/enstellar
KEYCLOAK_ISSUER_URI: http://localhost:8081/realms/enstellar
```

`KEYCLOAK_JWK_SET_URI` stays `http://keycloak:8080/...` — Spring Security uses `jwk-set-uri` for JWKS fetch (internal, reachable) and `issuer-uri` only for `iss` claim validation. The two properties are independent.

### 2c. BFF — no change required

The BFF uses `python-jose`'s `jwt.decode` without an `issuer` option, so it does not validate the `iss` claim. It accepts any token whose signature matches the JWKS. No BFF code change is needed for the issuer fix.

### 2d. Keycloak realm additions

Two entries must be added to `infra/compose/keycloak/enstellar-realm-ci-overlay.json`:

- **E2E reviewer user** — username `e2e-reviewer`, password from `${E2E_PASSWORD}`, `tenant_id=tenant-dev`, `reviewer` role. The existing `enstellar-test-client` (already in the overlay with `directAccessGrantsEnabled: true` and `serviceAccountsEnabled: true`) is reused for both `password` grant (Playwright) and `client_credentials` grant (seed script + pytest).

### 2e. Playwright auth — token injection

E2E `beforeAll` fetches a real token via resource-owner password grant:

```
POST http://localhost:8081/realms/enstellar/protocol/openid-connect/token
  grant_type=password
  client_id=enstellar-web
  username=$E2E_USER
  password=$E2E_PASSWORD
```

Token injected into Playwright browser context via `page.setExtraHTTPHeaders({ Authorization: 'Bearer <token>' })`. No browser login UI needed.

Two new GitHub secrets required before first nightly run: `E2E_USER`, `E2E_PASSWORD`.

---

## 3. E2E Seed Script

### 3a. `scripts/e2e_seed.py`

New Python script (run via `uv run --project services/workflow-engine`). Uses stable deterministic resource IDs (e.g. `e2e-patient-001`) so the script is idempotent — PUT if exists, POST if not.

**Steps:**

1. Acquire a service-account bearer token from Keycloak (`client_credentials` grant, client `enstellar-test-client`). All calls carry `X-Tenant-Id: tenant-dev`.
2. PUT the following FHIR resources to `http://localhost:8080/fhir` (via interop proxy):
   - `Patient/e2e-patient-001` — US Core Patient profile
   - `Practitioner/e2e-practitioner-001` — US Core Practitioner profile
   - `Organization/e2e-org-001` — US Core Organization profile
   - `Coverage/e2e-coverage-001` — Da Vinci PAS Coverage profile, referencing patient + org
3. POST a minimal valid PAS `Claim/$submit` bundle to `http://localhost:8080/fhir/Claim/$submit`. Extract `claim_id` from the submitted bundle's `Claim.id` field (set deterministically to `e2e-claim-001`).
4. `$submit` creates the workflow case asynchronously via Kafka. Poll `GET http://localhost:8001/worklist` (or search by patient ID) every 2 seconds up to 30 seconds until a case for `e2e-patient-001` appears. Record the returned `case_id`.
5. Write `infra/compose/e2e-fixture-manifest.json`:
   ```json
   {
     "patient_id":      "e2e-patient-001",
     "practitioner_id": "e2e-practitioner-001",
     "org_id":          "e2e-org-001",
     "coverage_id":     "e2e-coverage-001",
     "case_id":         "<workflow-engine-uuid>",
     "claim_id":        "e2e-claim-001"
   }
   ```

### 3b. `scripts/e2e_teardown.py`

Deletes all seeded resources by their stable IDs via `DELETE /fhir/<type>/<id>`. Safe to run after `make down -v` (idempotent — ignores 404).

### 3c. Makefile targets

```makefile
e2e-seed:
    uv run --project services/workflow-engine python scripts/e2e_seed.py

e2e-teardown:
    uv run --project services/workflow-engine python scripts/e2e_teardown.py
```

---

## 4. pytest Path B — Direct PAS / X12 278

**File:** `tests/e2e/test_pas_direct.py` (pytest + httpx, async)

**Scenario:** POST a valid PAS bundle directly to interop `$submit` → workflow auto-approves → ClaimResponse retrievable.

### Shared helpers — `tests/e2e/helpers.py`

| Helper | Purpose |
|---|---|
| `load_manifest() -> dict` | Read `e2e-fixture-manifest.json` |
| `get_service_token() -> str` | `client_credentials` grant to Keycloak (`http://localhost:8081/realms/enstellar/protocol/openid-connect/token`, client `enstellar-e2e-service`) |
| `wait_for_case_state(case_id, target, timeout=60, interval=2) -> dict` | Poll `GET http://localhost:8001/cases/{case_id}` until `state == target`; raise `TimeoutError` with clear message on expiry |

Note: The BFF mounts the cases router with `prefix="/bff"` in `main.py`, so the full path is `/bff/cases/{case_id}` at port 8001. Nginx proxies `/bff/` → `portal-bff:8001` preserving the path — both direct and proxied callers use the same `/bff/` prefix.

### Test steps

1. **Setup** — `load_manifest()`, `get_service_token()`. All httpx calls carry `Authorization: Bearer <token>` + `X-Tenant-Id: tenant-dev`.

2. **Submit PAS bundle** — `POST http://localhost:8080/fhir/Claim/$submit` with a minimal Da Vinci PAS bundle (Claim + Patient + Coverage + Organization + Practitioner, all referencing seeded IDs). Assert HTTP 200 or 202. Extract `claim_id` from the bundle's `Claim.id` field.

3. **Poll workflow** — `wait_for_case_state(case_id, target="approved", timeout=60)`.

4. **Assert decision recorder** — case detail response contains a decision event with `outcome=approved`, `actor_type=auto_determination`, and a non-null `recorded_at` timestamp.

5. **Assert final ClaimResponse via `$inquire`** — `GET http://localhost:8080/fhir/Claim/{correlation_id}/$inquire` (where `correlation_id` = bundle ID set at seed time, e.g. `e2e-bundle-001`) returns a Bundle containing a ClaimResponse with `outcome=complete`. The `PasClaimInquireProvider` reads the `DecisionRecord` (updated by `DecisionEventConsumer` from the Kafka `decision.recorded` event) and builds the response.

6. **Assert comms fired** — case events timeline contains at least one notification event (type `notification_sent`).

### `tests/e2e/conftest.py`

Session-scoped fixture that loads manifest + token once; shared across all E2E pytest tests.

### `tests/e2e/pyproject.toml`

Minimal: `pytest`, `pytest-asyncio`, `httpx`, `pytest-json-report`. No Testcontainers — the stack is already up via `make up`.

---

## 5. Playwright Path A — CRD → DTR → PAS Browser Flow

**File:** `apps/web/e2e/real-stack/ehr-to-pa.spec.ts`

Active only when `PLAYWRIGHT_REAL_STACK=1`. Reads manifest from path in `E2E_MANIFEST` env var (default: `../../infra/compose/e2e-fixture-manifest.json`).

### Test steps

1. **`beforeAll`** — read manifest; fetch token via resource-owner password grant to `http://localhost:8081/realms/enstellar/protocol/openid-connect/token` using `E2E_USER` / `E2E_PASSWORD` env vars. Inject via `page.setExtraHTTPHeaders({ Authorization: 'Bearer <token>' })`.

2. **Fire CDS Hook** — navigate to `/ehr-sim`; fill `patient_id` = `e2e-patient-001`, service code = `99213`; click "Check Coverage Requirements". Assert: CRD card appears with `summary` containing "Prior Authorization Required" and a DTR launch link.

3. **Launch DTR** — click the DTR launch link on the card. Assert: navigation to `/dtr-form`. Assert: at least one question rendered.

4. **Complete and submit questionnaire** — fill all required fields with fixture answers (hard-coded strings appropriate to the seeded service code). Click Submit. Assert: success state visible, no error banner.

5. **Poll workflow for `approved` state** — use Playwright `request` context to poll `http://localhost:8001/cases/{case_id}` (case_id from manifest) every 2 seconds up to 60 seconds. Direct call to BFF port 8001; no `/bff/` prefix. Fail with a descriptive message on timeout.

6. **Assert final ClaimResponse via `$inquire`** — Playwright `request` context: `GET http://localhost:8080/fhir/Claim/{correlation_id}/$inquire` (correlation_id = `e2e-bundle-001` from manifest). Assert the returned Bundle's ClaimResponse entry has `outcome=complete`.

### Playwright config changes — `apps/web/playwright.config.ts`

When `PLAYWRIGHT_REAL_STACK=1`:
- `webServer` block removed (stack already up via `make up`).
- `testDir` extended to include `e2e/real-stack/`.
- `baseURL` remains `http://localhost:5173`.

The existing mock-BFF tests (`e2e/*.spec.ts`) are unaffected — they continue to run via `make e2e-web` against the mock BFF.

---

## 6. Makefile `make e2e` Target

```makefile
e2e: e2e-seed
    @set -e; \
    trap '$(MAKE) e2e-teardown' EXIT; \
    cd tests/e2e && uv run pytest -v \
      --json-report --json-report-file=/tmp/e2e-pytest.json; \
    cd apps/web && \
      PLAYWRIGHT_REAL_STACK=1 \
      E2E_MANIFEST=../../infra/compose/e2e-fixture-manifest.json \
      npx playwright test e2e/real-stack/
```

Update `.PHONY` to include `e2e-seed e2e-teardown`.

---

## 7. CI — Nightly Job Addition

Add `e2e` job to `.github/workflows/nightly.yml`:

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: docker/setup-buildx-action@v3
    - uses: actions/setup-java@v4
      with: { java-version: '21', distribution: 'temurin' }
    - uses: actions/setup-python@v5
      with: { python-version: '3.12' }
    - run: pip install uv
    - name: Install Playwright browsers
      run: cd apps/web && npm ci && npx playwright install chromium
    - name: Bring up stack
      run: make up
    - name: Run E2E
      run: make e2e
      env:
        E2E_USER:     ${{ secrets.E2E_USER }}
        E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}
    - name: Upload E2E results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: e2e-results
        path: |
          /tmp/e2e-pytest.json
          apps/web/test-results/
        retention-days: 30
    - name: Tear down stack
      if: always()
      run: make down
```

**Required GitHub secrets before first run:** `E2E_USER`, `E2E_PASSWORD`.

---

## 8. Non-Negotiable Invariants

All existing invariants carry through:

- **No autonomous adverse determinations** — path B auto-approval asserted as `actor_type=auto_determination` (system-initiated, not adversarial). The adverse-transition guard is not exercised in E2E (tested in unit/IT layer). No E2E test may issue or simulate an adverse determination without a recorded human signoff.
- **No LLM on the decision path** — CRD/DTR advisory cards and questionnaire prepopulation are advisory outputs only. E2E assertions verify workflow outcome, not AI output quality.
- **PHI minimum-necessary** — seeded data uses synthetic identifiers. No real PHI in fixtures, logs, or CI artifacts.
- **Tenant-scoped** — all E2E calls carry `X-Tenant-Id: tenant-dev`. A separate tenant-isolation assertion (`tenant-dev2` case must not appear in `tenant-dev` worklist) is included in the pytest suite.
- **Standards conformance** — seeded PAS bundle validated against Da Vinci PAS 2.0.1 profile before submission.

---

## 9. Files Created / Modified

| Path | Action |
|---|---|
| `tests/e2e/__init__.py` | Create — empty, makes it a package |
| `tests/e2e/pyproject.toml` | Create — pytest + httpx + pytest-asyncio + pytest-json-report |
| `tests/e2e/conftest.py` | Create — session-scoped manifest + token fixtures |
| `tests/e2e/helpers.py` | Create — `load_manifest`, `get_service_token`, `wait_for_case_state` |
| `tests/e2e/test_pas_direct.py` | Create — path B test |
| `apps/web/e2e/real-stack/ehr-to-pa.spec.ts` | Create — path A browser test |
| `apps/web/playwright.config.ts` | Modify — real-stack mode |
| `scripts/e2e_seed.py` | Create — FHIR fixture seeder |
| `scripts/e2e_teardown.py` | Create — FHIR fixture teardown |
| `infra/compose/docker-compose.yml` | Modify — `KC_HOSTNAME_URL`, `KEYCLOAK_ISSUER_URI` (interop), `BFF_KEYCLOAK_ISSUER_URL` |
| `infra/compose/keycloak/enstellar-realm-ci-overlay.json` | Modify — add `e2e-reviewer` user |
| `Makefile` | Modify — `e2e`, `e2e-seed`, `e2e-teardown` targets |
| `.github/workflows/nightly.yml` | Modify — add `e2e` job |

---

## 10. Definition of Done

- `make e2e-seed` runs cleanly against a healthy stack and writes `e2e-fixture-manifest.json`.
- `pytest tests/e2e/` (path B) exits 0: PAS bundle accepted, workflow reaches `approved`, ClaimResponse retrievable, comms event present.
- `PLAYWRIGHT_REAL_STACK=1 npx playwright test e2e/real-stack/` (path A) exits 0: CRD card rendered, DTR questionnaire completed, workflow reaches `approved`, ClaimResponse retrievable.
- `make e2e-teardown` runs cleanly (idempotent on 404).
- Nightly CI job green; results archived as artifacts.
- Keycloak issuer mismatch resolved: authenticated browser flows no longer 401.
