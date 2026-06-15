# Conformance Hardening — Design Spec

**Date:** 2026-06-07
**Track:** A — FHIR conformance (US Core 5.0.1 + Da Vinci PAS 2.0.1)
**Resolves:** TD-01 (custom FHIR storage)
**Review class:** sensitive (FHIR conformance) — mandatory senior-engineer review before merge

---

## Problem

`make conformance` is a stub. Three gaps block an Inferno conformance pass:

1. **Custom FHIR storage (TD-01):** `services/interop/` uses a hand-rolled `fhir_resource` JSONB table. It cannot serve FHIR search parameters (`_include`, `_revinclude`, `_sort`, pagination) that Inferno requires for US Core tests.
2. **No profile validation:** The PAS bundle validator is structural-only. HAPI's profile engine (which validates against loaded StructureDefinitions) is not wired.
3. **No Inferno runner:** No container, no CI job, no `make conformance` implementation.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| TD-01 migration option | Option A — proxy over HAPI Docker image | HAPI container already in compose; avoids re-litigating Spring Boot JPA wiring that failed 3× during T05 |
| IG versions | US Core 5.0.1 + Da Vinci PAS 2.0.1 | CMS/Medicaid direction; PAS 2.0.1 depends on US Core 5.0.1 |
| HAPI multi-tenancy | Single partition + `meta.security` tags | No URL-prefix rewrite needed; same isolation class as current SQL `WHERE tenant_id=?` |
| Inferno scope | US Core 5.0.1 read/search happy path + PAS 2.0.1 submit/inquire happy path | Matches P1 exit criteria; full Inferno suite deferred |
| Auth in conformance tests | `INTEROP_CONFORMANCE_TEST_MODE` static bearer token | Mirrors `BFF_DEV_BYPASS_AUTH` pattern; never enabled in staging/prod |

---

## Architecture

```
Client / EHR / Inferno
        ↓ :8080/fhir
services/interop/ (Spring Boot — thin FHIR proxy)
  ├── JwtTenantFilter              JWT → tenant_id  (unchanged)
  ├── ConformanceTestAuthFilter    static token bypass (test only, guarded by env var)
  ├── PasSubmitProvider            POST /fhir/Claim/$submit  (business logic, unchanged)
  ├── PasInquireProvider           GET  /fhir/Claim/{id}/$inquire  (unchanged)
  └── FhirProxyFilter              all other /fhir/**
        ├── writes  → inject meta.security tenant tag → forward
        ├── reads   → forward → assert meta.security matches tenant
        └── searches → append _security={tenant_id} param → forward
              ↓ internal Docker network (hapi:8080/fhir)
        hapiproject/hapi:v7.4.0
          ├── hapi-db (PostgreSQL 16)
          ├── US Core 5.0.1 IG
          ├── Da Vinci PAS 2.0.1 IG
          └── profile validation on inbound requests
```

HAPI is not exposed externally. All FHIR traffic enters through the proxy, which enforces JWT auth and tenant isolation before forwarding.

---

## Component Specifications

### CH1 — HAPI docker-compose configuration

**File:** `infra/compose/docker-compose.yml`

Changes to the existing `hapi` service:

```yaml
hapi:
  image: hapiproject/hapi:v7.4.0
  expose:
    - "8080"          # internal only — remove external ports mapping
  depends_on:
    hapi-db:
      condition: service_healthy
  environment:
    spring.datasource.url: jdbc:postgresql://hapi-db:5432/hapi
    spring.datasource.username: hapi
    spring.datasource.password: ${HAPI_DB_PASSWORD:-hapi_secret}
    spring.datasource.driverClassName: org.postgresql.Driver
    spring.jpa.properties.hibernate.dialect: ca.uhn.fhir.jpa.model.dialect.HapiFhirPostgres94Dialect
    hapi.fhir.fhir_version: R4
    hapi.fhir.allow_multiple_delete: "true"
    hapi.fhir.allow_external_references: "true"
    hapi.fhir.validation.requests_enabled: "true"
    hapi.fhir.validation.responses_enabled: "false"
    hapi.fhir.implementationguides[0].name: hl7.fhir.us.core
    hapi.fhir.implementationguides[0].version: 5.0.1
    hapi.fhir.implementationguides[0].reloadExisting: "false"
    hapi.fhir.implementationguides[1].name: hl7.fhir.us.davinci-pas
    hapi.fhir.implementationguides[1].version: 2.0.1
    hapi.fhir.implementationguides[1].reloadExisting: "false"
  healthcheck:
    test: ["CMD", "java", "-jar", "/healthcheck.jar", "http://localhost:8080/actuator/health"]
    interval: 30s
    timeout: 15s
    retries: 10
    start_period: 120s   # IG loading extends startup time
```

**Note:** HAPI downloads IG packages from `packages.fhir.org` on first startup and caches them in `hapi-db`. CI requires outbound internet access on the first run. Subsequent runs use the cached packages (no download).

**Inferno service** (new, `conformance` profile only):

```yaml
inferno:
  image: infernoframework/inferno-core:latest
  profiles: ["conformance"]
  depends_on:
    interop:
      condition: service_healthy
  environment:
    FHIR_BASE_URL: http://interop:8080/fhir
  ports:
    - "4567:4567"
```

`profiles: ["conformance"]` means `make up` does not start Inferno. It starts only via `make conformance` or `docker compose --profile conformance up`.

---

### CH2 — FhirProxyFilter

**File:** `services/interop/src/main/java/com/simintero/enstellar/interop/proxy/FhirProxyFilter.java`

A `OncePerRequestFilter` that intercepts all `/fhir/**` requests not handled by `$submit` or `$inquire` controllers.

**Tenant isolation via `meta.security`:**

Security tag shape (FHIR `Coding`):
```json
{
  "system": "https://enstellar.simintero.com/tenants",
  "code": "{tenant_id}"
}
```

Behavior per HTTP method:

| Method | Proxy action |
|---|---|
| `POST` / `PUT` | Parse request body as FHIR JSON; inject `meta.security` tag; forward mutated body to HAPI |
| `GET` (search — no `{id}` segment) | Append `_security=https://enstellar.simintero.com/tenants\|{tenant_id}` to query string before forwarding |
| `GET` (read — has `{id}` segment) | Forward verbatim; verify response resource's `meta.security` contains tenant tag; return 403 if absent or mismatched |
| `DELETE` | Fetch resource first; verify tenant tag; forward delete only if tenant matches; 403 otherwise |
| `GET /fhir/metadata` | Forward verbatim (no tenant check — CapabilityStatement is server-wide) |

**Hop-by-hop headers** stripped on both request and response: `Connection`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailers`, `Upgrade`.

**HAPI base URL** injected via `@ConfigurationProperties`:
```yaml
# services/interop/src/main/resources/application.yml
interop:
  hapi:
    base-url: http://hapi:8080/fhir
```

**Implementation note:** Use Java `HttpClient` (JDK 11+) or Spring's `RestTemplate` for forwarding. Do not use `WebClient` (interop service is servlet-based, not reactive). Buffer request body once for mutation; stream response body back to avoid holding large bundles in memory.

---

### CH3 — ConformanceTestAuthFilter

**File:** `services/interop/src/main/java/com/simintero/enstellar/interop/auth/ConformanceTestAuthFilter.java`

Activated only when `INTEROP_CONFORMANCE_TEST_MODE=true`. Accepts a static bearer token (`conformance-test-token` by default, overridable via `INTEROP_CONFORMANCE_TEST_TOKEN`) and sets tenant_id to `conformance-test` in the request context.

```java
@Component
@ConditionalOnProperty(name = "interop.conformance-test-mode", havingValue = "true")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ConformanceTestAuthFilter extends OncePerRequestFilter {
    // reads INTEROP_CONFORMANCE_TEST_TOKEN env var
    // if Authorization header matches, sets TenantContext.set("conformance-test") and calls chain.doFilter()
    // JwtTenantFilter must check TenantContext.isSet() and skip if already populated
    // invalid/missing token falls through to JwtTenantFilter as normal
}
```

**Security invariant:** This filter must never activate unless `interop.conformance-test-mode=true` is explicitly set. It is not compiled out — it is guarded by `@ConditionalOnProperty`. The conformance compose override sets this env var; production compose does not. A test asserts the filter is absent from the Spring context when the property is unset.

---

### CH4 — Remove custom FHIR storage

**Files removed:**
- `services/interop/src/main/java/com/simintero/enstellar/interop/fhir/FhirResourceEntity.java`
- `services/interop/src/main/java/com/simintero/enstellar/interop/fhir/FhirResourceRepository.java`
- `services/interop/src/main/java/com/simintero/enstellar/interop/conformance/EnstellarCapabilityStatementProvider.java`
- `services/interop/src/main/java/com/simintero/enstellar/interop/resources/PatientResourceProvider.java`
- `services/interop/src/main/java/com/simintero/enstellar/interop/resources/DocumentReferenceResourceProvider.java`
- Flyway migration: `V{next}__drop_fhir_resource_table.sql`

**`build.gradle` changes:**
- Remove: `implementation 'org.springframework.boot:spring-boot-starter-data-jpa'`
- Remove: `implementation 'org.hibernate.orm:hibernate-core'`
- Add: `implementation 'org.apache.httpcomponents.client5:httpclient5:5.3.1'`

**`application.yml` changes:**
- Remove: `spring.jpa.*` block
- Add:
  ```yaml
  interop:
    hapi:
      base-url: ${HAPI_BASE_URL:http://hapi:8080/fhir}
    conformance-test-mode: ${INTEROP_CONFORMANCE_TEST_MODE:false}
  ```

**`FhirCapabilityProperties` / `application.yml` resource config** — update profile URLs to US Core 5.0.1 + PAS 2.0.1:
```yaml
interop.fhir.capability.resources:
  - type: Patient
    profile: http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|5.0.1
    interactions: [read, search-type, create, update]
  - type: Practitioner
    profile: http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner|5.0.1
    interactions: [read, search-type, create]
  - type: Coverage
    profile: http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-coverage-pas|2.0.1
    interactions: [read, search-type, create]
  - type: Organization
    profile: http://hl7.org/fhir/us/core/StructureDefinition/us-core-organization|5.0.1
    interactions: [read, search-type, create]
```

Note: `EnstellarCapabilityStatementProvider` is removed. HAPI generates the CapabilityStatement from the loaded IGs. The proxy's `/fhir/metadata` passthrough returns HAPI's generated statement, which is what Inferno validates.

---

### CH5 — `make conformance` and CI

**Makefile** — replace the stub:
```makefile
## Run FHIR conformance tests (US Core 5.0.1 + Da Vinci PAS 2.0.1). Requires make up.
conformance:
	$(COMPOSE) --profile conformance up -d --wait
	$(COMPOSE) --profile conformance exec inferno \
	  inferno suite run \
	    --suite us_core_501 \
	    --url http://interop:8080/fhir \
	    --bearer-token conformance-test-token \
	    --output /tmp/us-core-results.json
	$(COMPOSE) --profile conformance exec inferno \
	  inferno suite run \
	    --suite davinci_pas_201 \
	    --url http://interop:8080/fhir \
	    --bearer-token conformance-test-token \
	    --output /tmp/pas-results.json
	$(COMPOSE) --profile conformance stop inferno
```

**Implementation note:** Inferno CLI suite IDs are version-specific strings defined by the Inferno Framework image. The implementer must verify exact suite IDs by running `inferno suite list` against the pinned `infernoframework/inferno-core` image version before wiring the Makefile target. Placeholder IDs above (`us_core_501`, `davinci_pas_201`) must be replaced with the actual values.

Exit code is non-zero if any required test fails (Inferno CLI returns non-zero on suite failure).

**CI job** added to `.github/workflows/ci.yml`:
```yaml
conformance:
  name: FHIR Conformance (Inferno)
  runs-on: ubuntu-latest
  needs: [test-interop]
  steps:
    - uses: actions/checkout@v4
    - name: Start local stack
      run: make up
    - name: Run conformance suite
      run: make conformance
    - name: Upload Inferno results
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: inferno-results
        path: /tmp/*-results.json
    - name: Tear down
      if: always()
      run: make down
```

---

## Test Strategy

### Updated tests (services/interop/)

| Test class | Change | What it verifies |
|---|---|---|
| `CapabilityStatementIT` | Update: assert US Core 5.0.1 and PAS 2.0.1 profile URLs present in HAPI-generated CS; remove assertion for custom `EnstellarCapabilityStatementProvider` | HAPI loads IGs and declares correct profiles |
| `PasSubmitIT` | No change to test logic; now runs against proxy+HAPI stack via Testcontainers | $submit business logic intact through proxy |
| `PasInquireIT` | No change to test logic | $inquire intact through proxy |
| `TenantIsolationIT` | Update: seed resources via proxy (HTTP POST to `/fhir/Patient`); assert resource has `meta.security` tag; assert GET from different tenant returns 403 | Proxy enforces tenant isolation |
| `PatientResourceIT` | Update: seed via proxy; assert response profile URL is US Core 5.0.1 | HAPI stores and returns US Core-profiled resources |

### New tests

| Test class | What it verifies |
|---|---|
| `FhirProxyFilterTest` | Unit: security tag injected on POST; `_security` param appended on GET search; tenant mismatch on read returns 403; `$submit`/`$inquire` paths bypassed |
| `ConformanceTestAuthFilterTest` | Unit: filter absent when `conformance-test-mode=false`; static token accepted when `=true`; invalid token still 401 |
| `HapiIgLoadIT` | Integration (Testcontainers): HAPI starts with US Core 5.0.1 + PAS 2.0.1 loaded; POST of a US Core Patient with correct profile returns 201; POST with invalid profile returns 422. **Note:** uses `@Testcontainers` with `withEnv("hapi.fhir.implementationguides[0].*", ...)` — requires outbound internet access (packages.fhir.org) on the first run; packages are cached in the HAPI Postgres volume on subsequent runs. Mark this test `@Tag("integration")` so it can be skipped in offline environments. |

### `make conformance` (Inferno)

Inferno runs the following test groups as the pass gate. Optional/informational tests may fail without breaking CI; required tests must pass:

**US Core 5.0.1 (required):**
- Patient read + search by name, birthdate, identifier
- Practitioner read + search by name, identifier
- Coverage read
- Organization read
- `GET /fhir/metadata` returns CapabilityStatement declaring US Core 5.0.1 profiles

**Da Vinci PAS 2.0.1 (required):**
- `POST /fhir/Claim/$submit` with PAS-profiled bundle → 200 + ClaimResponse
- `GET /fhir/Claim/{id}/$inquire` → ClaimResponse with correct outcome

---

## Out of Scope

- Full Inferno US Core test suite (complex search: `_include`, `_revinclude`, chained refs) — deferred; current storage limitation removed by this work, full suite pass in a follow-on
- Touchstone integration — Inferno covers the same ground for local CI; Touchstone deferred to design-partner onboarding
- `_history` endpoint — HAPI supports it out of the box once JPA is the storage; no extra work required but not gated in this spec
- Clinician identity validation in `ConformanceTestAuthFilter` — same scope exclusion as existing `BFF_DEV_BYPASS_AUTH`
- X12 278 conformance (Track B) — separate spec
- Agent evals hardening (Track C) — separate spec

---

## Invariants (unchanged, must stay green)

1. No adverse determination without human sign-off — not touched by this work
2. No PHI in logs — proxy filter must not log request/response bodies
3. Tenant isolation — `TenantIsolationIT` must stay green; proxy enforces via `meta.security`
4. No hand-edited CapabilityStatement — `EnstellarCapabilityStatementProvider` is removed; HAPI generates from loaded IGs
5. Pinned IG versions — US Core 5.0.1 and PAS 2.0.1 are explicit version pins in compose env vars

---

## Task Map

| Task | Stack | Files | Review class |
|---|---|---|---|
| CH1 HAPI compose config + IG loading | infra | `docker-compose.yml` | **sensitive (FHIR)** |
| CH2 FhirProxyFilter | JVM | `proxy/FhirProxyFilter.java`, `HapiBaseUrlProperties.java` | **sensitive (FHIR)** |
| CH3 ConformanceTestAuthFilter | JVM | `auth/ConformanceTestAuthFilter.java` | **sensitive (auth)** |
| CH4 Remove custom FHIR storage | JVM | ResourceProviders, FhirResourceEntity, CapabilityStatementProvider, build.gradle, migration | **sensitive (FHIR)** |
| CH5 make conformance + CI | infra | `Makefile`, `ci.yml`, `docker-compose.yml` | infra |
| CH6 Update T05 tests | JVM | `*IT.java` test files | **sensitive (FHIR)** |
| CH7 New proxy + IG load tests | JVM | `FhirProxyFilterTest.java`, `ConformanceTestAuthFilterTest.java`, `HapiIgLoadIT.java` | **sensitive (FHIR)** |
