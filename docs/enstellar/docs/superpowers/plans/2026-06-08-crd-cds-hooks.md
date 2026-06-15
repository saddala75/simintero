# CRD (CDS Hooks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add standards-conformant Da Vinci CRD via CDS Hooks 2.0 to `services/interop` (discovery + `order-select`/`order-sign`/`appointment-book`), returning advisory cards sourced from Digicore (one launches DTR), with a BFF proxy and an in-house "simulate EHR order" page in `apps/web`.

**Architecture:** CRD is the first plain Spring `@RestController` in interop, mounted at `/cds-services` (the DispatcherServlet path, separate from HAPI's `/fhir/*`). It calls the Digicore mock over HTTP via a new Java `DigicoreClient` (mirrors the existing `NormalizationClient` WebClient) and maps `CRDContent` → CDS Hooks `Card`s. CDS Hooks is unauthenticated transport (`permitAll`); tenant is supplied by the caller via an `X-Tenant-Id` header for the pilot sim (a real EHR will map via registration/`fhirAuthorization` later). BFF proxies the invoke; the web sim fires a hook and renders the cards.

**Tech Stack:** Java 21, Spring Boot (spring-boot-starter-web, already present), HAPI FhirContext (R4), Spring WebFlux WebClient; Python FastAPI (mock); FastAPI BFF (httpx); React 19 + Vite 8 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-08-crd-cds-hooks-design.md`. **Invariants:** advisory-only (cards only, no determination), tenant-scoped, PHI minimum-necessary (no PHI in logs), pinned IG (Da Vinci CRD 2.0.1). **Review class:** sensitive (FHIR) — mandatory senior review.

**Verification model:** Java = JUnit unit + Testcontainers/WireMock IT (tagged `integration`, run with `-PincludeIntegration`; default `./gradlew :test` excludes them). Use `./gradlew :test --tests "<pat>"` scoped to root project (the wrapper now forwards args; an unscoped `test --tests` fails on the x12-translator subproject). Python BFF = pytest+respx. Web = Playwright against the mock BFF.

**Key facts (do not re-derive):**
- interop packages under `services/interop/src/main/java/com/simintero/enstellar/interop/` — `pas/`, `config/`, `auth/`, `proxy/`, `decision/`. New package: `crd/`.
- `FhirContext` bean in `config/FhirConfig.java`. Config-properties precedent: `config/PasConfig.java` (record, `@ConfigurationProperties(prefix="enstellar.pas")`, registered on `InteropApplication` via `@EnableConfigurationProperties`).
- WebClient client precedent: `pas/NormalizationClient.java` (builds `WebClient` from a base URL, `.post().uri(...).bodyValue(...).retrieve().bodyToMono(...).block(Duration.ofSeconds(30))`).
- Tenant: `auth/TenantContext.java` (`set/require/clear/isSet`). `TenantContextFilter` only sets tenant from a JWT — so an unauthenticated `/cds-services` request leaves it unset; the CRD controller must set it explicitly from the `X-Tenant-Id` header.
- `SecurityConfig.java` `filterChain` (lines ~43-75): `permitAll` entries use `AntPathRequestMatcher`; everything else `authenticated()`. Add `/cds-services` + `/cds-services/**` permitAll via `AntPathRequestMatcher`.
- Digicore mock: `GET http://mock-digicore:8000/api/v1/crd?service_code=&member_id=&plan_id=&tenant_id=` → JSON `{pa_required: bool, documentation_requirements: string[], rule_reference: string, dtr_launch_url: string|null}`. interop compose block currently has NO `DIGICORE_BASE_URL` — add it.
- BFF: `enstellar_bff/main.py` includes routers; `config.py` `BffSettings` env prefix `BFF_`; `auth.py` `require_reviewer` dep returns `{"tenant_id","roles","sub"}`; downstream calls pass `X-Tenant-Id` header. Add `BFF_CRD_API_URL` (→ `http://interop:8080/cds-services`).
- web: routes in `src/App.tsx` (react-router 7); API helper `src/api/client.ts` (`BASE='/bff'`, `apiFetch<T>`); pages in `src/pages/`; types in `src/types/index.ts`; Playwright mock BFF at `apps/web/e2e/mock-bff.ts` (substring routing); no shared navbar (entry from `LandingPage`).

---

## Task 1: Java DigicoreClient + config + compose env

**Files:**
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/crd/DigicoreConfig.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/crd/DigicoreClient.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/crd/CrdContent.java`
- Modify: `services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java` (add `DigicoreConfig` to `@EnableConfigurationProperties`)
- Modify: `services/interop/src/main/resources/application.yml` (add `enstellar.digicore.base-url`)
- Modify: `infra/compose/docker-compose.yml` (interop env: `DIGICORE_BASE_URL`)
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/crd/DigicoreClientIT.java`

- [ ] **Step 1: Config-properties record** — `DigicoreConfig.java`:
```java
package com.simintero.enstellar.interop.crd;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enstellar.digicore")
public record DigicoreConfig(String baseUrl) {}
```

- [ ] **Step 2: CrdContent DTO** (matches the mock JSON) — `CrdContent.java`:
```java
package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public record CrdContent(
        @JsonProperty("pa_required") boolean paRequired,
        @JsonProperty("documentation_requirements") List<String> documentationRequirements,
        @JsonProperty("rule_reference") String ruleReference,
        @JsonProperty("dtr_launch_url") String dtrLaunchUrl) {}
```

- [ ] **Step 3: DigicoreClient** (mirror `pas/NormalizationClient.java`) — `DigicoreClient.java`:
```java
package com.simintero.enstellar.interop.crd;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import java.time.Duration;

@Component
public class DigicoreClient {
    private final WebClient webClient;

    public DigicoreClient(DigicoreConfig config) {
        this.webClient = WebClient.builder().baseUrl(config.baseUrl()).build();
    }

    public CrdContent getCrdContent(String serviceCode, String memberId, String planId, String tenantId) {
        return webClient.get()
                .uri(uri -> uri.path("/api/v1/crd")
                        .queryParam("service_code", serviceCode)
                        .queryParam("member_id", memberId)
                        .queryParam("plan_id", planId)
                        .queryParam("tenant_id", tenantId)
                        .build())
                .retrieve()
                .bodyToMono(CrdContent.class)
                .block(Duration.ofSeconds(15));
    }
}
```

- [ ] **Step 4: Register config + yaml + compose env.**
  - `InteropApplication.java`: add `DigicoreConfig.class` to the existing `@EnableConfigurationProperties({PasConfig.class, ...})` list (create the annotation arg list if it currently lists only `PasConfig`).
  - `application.yml` under `enstellar:` add:
    ```yaml
      digicore:
        base-url: ${DIGICORE_BASE_URL:http://mock-digicore:8000}
    ```
  - `docker-compose.yml` interop `environment:` add `DIGICORE_BASE_URL: http://mock-digicore:8000`. Also add `depends_on: mock-digicore: {condition: service_healthy}` to the interop service.

- [ ] **Step 5: IT** — `DigicoreClientIT.java` (mirror `pas/PasSubmitIT.java` WireMock setup: static `WireMockServer`, `@DynamicPropertySource` mapping `DIGICORE_BASE_URL` → `http://localhost:{port}`, `@Tag("integration")`, extends `FhirTestBase`). One test: stub `GET /api/v1/crd` → the JSON above; assert `getCrdContent(...)` returns a `CrdContent` with `paRequired=true` and the two documentation requirements.

- [ ] **Step 6: Verify + commit.**
  - `cd services/interop && ./gradlew :test --tests "*DigicoreClientIT" -PincludeIntegration 2>&1 | tail -15` → BUILD SUCCESSFUL.
  - `git add services/interop/src/main/java/com/simintero/enstellar/interop/crd/ services/interop/src/test/java/com/simintero/enstellar/interop/crd/DigicoreClientIT.java services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java services/interop/src/main/resources/application.yml infra/compose/docker-compose.yml`
  - commit `feat(crd): Java Digicore client + config + compose wiring`

---

## Task 2: CDS Hooks DTOs + CrdCardMapper (unit-tested)

**Files:**
- Create: `crd/CdsHooksRequest.java`, `crd/Card.java`, `crd/CdsServicesResponse.java`, `crd/CrdCardMapper.java`
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/crd/CrdCardMapperTest.java`

- [ ] **Step 1: DTOs.**
`CdsHooksRequest.java` (CDS Hooks 2.0 invoke body — minimal fields we use):
```java
package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CdsHooksRequest(
        String hook,
        String hookInstance,
        Map<String, Object> context,
        Map<String, Object> prefetch,
        Object fhirAuthorization) {}
```
`Card.java` (CDS Hooks Card + Link + Source):
```java
package com.simintero.enstellar.interop.crd;

import java.util.List;

public record Card(String summary, String indicator, String detail, Source source, List<Link> links) {
    public record Source(String label, String url) {}
    public record Link(String label, String url, String type, String appContext) {}
}
```
`CdsServicesResponse.java`:
```java
package com.simintero.enstellar.interop.crd;

import java.util.List;

public record CdsServicesResponse(List<Card> cards) {}
```

- [ ] **Step 2: Write the failing test** — `CrdCardMapperTest.java`:
```java
package com.simintero.enstellar.interop.crd;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class CrdCardMapperTest {
    private final CrdCardMapper mapper = new CrdCardMapper();

    @Test
    void pa_required_yields_dtr_launch_card_and_docs_card() {
        var content = new CrdContent(true, List.of("clinical-notes", "diagnosis-codes"),
                "mock-rule-stub-v1", "http://localhost:8080/dtr/launch");
        List<Card> cards = mapper.toCards(content, "svc-123");

        assertThat(cards).anySatisfy(c -> {
            assertThat(c.summary()).containsIgnoringCase("prior auth");
            assertThat(c.links()).anySatisfy(l -> {
                assertThat(l.type()).isEqualTo("smart");
                assertThat(l.url()).isEqualTo("http://localhost:8080/dtr/launch");
            });
        });
        assertThat(cards).anySatisfy(c -> assertThat(c.detail()).contains("clinical-notes"));
        // provenance: rule reference present on at least one source
        assertThat(cards).anySatisfy(c -> assertThat(c.source().url()).contains("mock-rule-stub-v1"));
    }

    @Test
    void pa_not_required_yields_info_card_with_rule_ref_no_launch() {
        var content = new CrdContent(false, List.of(), "rule-not-required-7", null);
        List<Card> cards = mapper.toCards(content, "svc-9");
        assertThat(cards).hasSize(1);
        assertThat(cards.get(0).summary()).containsIgnoringCase("not required");
        assertThat(cards.get(0).links()).isNullOrEmpty();
        assertThat(cards.get(0).source().url()).contains("rule-not-required-7");
    }
}
```
Run: `./gradlew :test --tests "*CrdCardMapperTest"` → FAIL (CrdCardMapper not defined).

- [ ] **Step 3: Implement `CrdCardMapper.java`.**
```java
package com.simintero.enstellar.interop.crd;

import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.List;

@Component
public class CrdCardMapper {
    private static final String RULE_BASE = "https://enstellar.simintero.com/crd-rule/";

    public List<Card> toCards(CrdContent content, String serviceCode) {
        var source = new Card.Source("Enstellar CRD", RULE_BASE + content.ruleReference());
        List<Card> cards = new ArrayList<>();
        if (!content.paRequired()) {
            cards.add(new Card("Prior authorization not required for " + serviceCode,
                    "info", "Coverage rule " + content.ruleReference() + " indicates no PA is required.",
                    source, null));
            return cards;
        }
        List<Card.Link> launch = content.dtrLaunchUrl() == null ? null
                : List.of(new Card.Link("Complete documentation (DTR)", content.dtrLaunchUrl(),
                        "smart", serviceCode));
        cards.add(new Card("Prior authorization required for " + serviceCode, "warning",
                "This service requires prior authorization. Launch DTR to complete documentation.",
                source, launch));
        if (content.documentationRequirements() != null && !content.documentationRequirements().isEmpty()) {
            cards.add(new Card("Documentation requirements", "info",
                    "Required: " + String.join(", ", content.documentationRequirements()),
                    source, null));
        }
        return cards;
    }
}
```
Run the test → PASS.

- [ ] **Step 4: Commit** `feat(crd): CDS Hooks DTOs + CrdCardMapper`.

---

## Task 3: CdsServicesController (discovery + invoke) + security permitAll

**Files:**
- Create: `crd/CdsServicesController.java`
- Modify: `config/SecurityConfig.java` (permitAll `/cds-services`, `/cds-services/**`)
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/crd/CdsServicesIT.java`

- [ ] **Step 1: Controller.** `CdsServicesController.java`:
```java
package com.simintero.enstellar.interop.crd;

import com.simintero.enstellar.interop.auth.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/cds-services")
public class CdsServicesController {
    private static final List<String> HOOKS = List.of("order-select", "order-sign", "appointment-book");
    private final DigicoreClient digicore;
    private final CrdCardMapper mapper;

    public CdsServicesController(DigicoreClient digicore, CrdCardMapper mapper) {
        this.digicore = digicore;
        this.mapper = mapper;
    }

    // Discovery
    @GetMapping
    public Map<String, Object> services() {
        List<Map<String, Object>> services = HOOKS.stream().map(h -> Map.<String, Object>of(
                "hook", h,
                "id", h,
                "title", "Enstellar CRD (" + h + ")",
                "description", "Coverage requirements discovery for " + h)).toList();
        return Map.of("services", services);
    }

    // Invoke
    @PostMapping("/{id}")
    public ResponseEntity<CdsServicesResponse> invoke(
            @PathVariable String id,
            @RequestHeader(value = "X-Tenant-Id", required = false) String tenantId,
            @RequestBody CdsHooksRequest request) {
        if (!HOOKS.contains(id)) {
            return ResponseEntity.notFound().build();
        }
        if (tenantId == null || tenantId.isBlank()) {
            return ResponseEntity.status(401).build();
        }
        try {
            TenantContext.set(tenantId);
            // Extract service/member/plan from the hook context (sim sends these keys).
            Map<String, Object> ctx = request.context() == null ? Map.of() : request.context();
            String serviceCode = String.valueOf(ctx.getOrDefault("serviceCode", "unknown"));
            String memberId = String.valueOf(ctx.getOrDefault("patientId", "unknown"));
            String planId = String.valueOf(ctx.getOrDefault("planId", "unknown"));
            CrdContent content = digicore.getCrdContent(serviceCode, memberId, planId, tenantId);
            return ResponseEntity.ok(new CdsServicesResponse(mapper.toCards(content, serviceCode)));
        } finally {
            TenantContext.clear();
        }
    }
}
```
(Advisory-only by construction: returns cards. Tenant set from header for the pilot; documented that a real EHR maps via `fhirAuthorization`/registration — out of scope.)

- [ ] **Step 2: Security permitAll.** In `SecurityConfig.java` `filterChain`, add to the `authorizeHttpRequests` block (alongside the existing `AntPathRequestMatcher` permitAll entries):
```java
.requestMatchers(new AntPathRequestMatcher("/cds-services")).permitAll()
.requestMatchers(new AntPathRequestMatcher("/cds-services/**")).permitAll()
```
(CDS Hooks is unauthenticated transport; the controller enforces tenant presence. Keep this above `anyRequest().authenticated()`.)

- [ ] **Step 3: IT** — `CdsServicesIT.java` (extends `FhirTestBase`, `@Tag("integration")`, static WireMock for Digicore via `@DynamicPropertySource` on `DIGICORE_BASE_URL`):
  - `discovery_lists_three_hooks`: `GET /cds-services` → 200, JSON `services` has 3 entries with hooks order-select/order-sign/appointment-book.
  - `order_sign_pa_required_returns_dtr_launch_card`: stub Digicore `GET /api/v1/crd` → pa_required true + dtr_launch_url; `POST /cds-services/order-sign` with header `X-Tenant-Id: t1` and body `{"hook":"order-sign","hookInstance":"x","context":{"serviceCode":"svc-1","patientId":"p1","planId":"plan-1"}}` → 200, a card with a `smart` link.
  - `missing_tenant_returns_401`: same POST without `X-Tenant-Id` → 401.
  - `unknown_hook_returns_404`: `POST /cds-services/nope` → 404.
  - Use `restTemplate` with `application/json`; no bearer token needed (permitAll).

- [ ] **Step 4: Verify + commit.** `./gradlew :test --tests "*CdsServicesIT" --tests "*CrdCardMapperTest" -PincludeIntegration` → green. Commit `feat(crd): CDS Hooks discovery + invoke controller (advisory cards, permitAll, tenant via header)`.

---

## Task 4: BFF crd router

**Files:**
- Create: `services/portal-bff/enstellar_bff/clients/crd.py`
- Create: `services/portal-bff/enstellar_bff/routers/crd.py`
- Modify: `services/portal-bff/enstellar_bff/config.py` (`crd_api_url`), `enstellar_bff/main.py` (include router), `enstellar_bff/models.py` (CRD request/response models)
- Test: `services/portal-bff/tests/test_crd.py`

- [ ] **Step 1: Config.** In `config.py` `BffSettings`, add `crd_api_url: str = "http://interop:8080/cds-services"` (env `BFF_CRD_API_URL`). Add `BFF_CRD_API_URL: http://interop:8080/cds-services` to the `portal-bff` compose env.

- [ ] **Step 2: Client.** `clients/crd.py` (mirror `clients/fhir.py` ephemeral httpx pattern):
```python
import httpx
from enstellar_bff.config import settings

class CrdClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    async def invoke(self, hook_id: str, body: dict, tenant_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{self._base}/{hook_id}", json=body,
                                  headers={"X-Tenant-Id": tenant_id}, timeout=15.0)
            r.raise_for_status()
            return r.json()

crd_client = CrdClient(settings.crd_api_url)
```

- [ ] **Step 3: Models** in `models.py` (Pydantic v2):
```python
class CrdHookRequest(BaseModel):
    hook: Literal["order-select", "order-sign", "appointment-book"]
    service_code: str
    patient_id: str
    plan_id: str

class CrdCardLink(BaseModel):
    label: str
    url: str
    type: str
    appContext: str | None = None

class CrdCard(BaseModel):
    summary: str
    indicator: str
    detail: str | None = None
    links: list[CrdCardLink] | None = None
```

- [ ] **Step 4: Router.** `routers/crd.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
import httpx
from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.crd import crd_client
from enstellar_bff.models import CrdHookRequest, CrdCard

router = APIRouter(prefix="/bff/crd")

@router.post("/invoke", response_model=list[CrdCard])
async def invoke(body: CrdHookRequest, auth: dict = Depends(require_reviewer)) -> list[CrdCard]:
    cds_request = {
        "hook": body.hook,
        "hookInstance": "sim-" + body.service_code,
        "context": {"serviceCode": body.service_code, "patientId": body.patient_id, "planId": body.plan_id},
    }
    try:
        result = await crd_client.invoke(body.hook, cds_request, auth["tenant_id"])
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail="CRD upstream error") from e
    return result.get("cards", [])
```
Include in `main.py`: `from enstellar_bff.routers import crd` and `app.include_router(crd.router)`.

- [ ] **Step 5: Test** `tests/test_crd.py` (mirror `tests/test_documents.py`: `dependency_overrides[require_reviewer]`, `@respx.mock` stubbing `http://interop:8080/cds-services/order-sign` → cards JSON; drive via `AsyncClient(ASGITransport(app))`). Assert `POST /bff/crd/invoke` returns the cards list.

- [ ] **Step 6: Verify + commit.** `cd services/portal-bff && uv run pytest tests/test_crd.py -v` → green. Commit `feat(crd): BFF crd router + client`.

---

## Task 5: Web "Simulate EHR order" page + nav + mock-bff + e2e

**Files:**
- Modify: `apps/web/src/types/index.ts` (CRD card types), `apps/web/src/api/client.ts` (`postCrdHook`), `apps/web/src/App.tsx` (route), `apps/web/src/pages/LandingPage.tsx` (nav link)
- Create: `apps/web/src/pages/EhrOrderSimPage.tsx`
- Modify: `apps/web/e2e/mock-bff.ts` (CRD route), create `apps/web/e2e/ehr-sim.spec.ts`

- [ ] **Step 1: Types** in `src/types/index.ts`:
```ts
export interface CrdCardLink { label: string; url: string; type: string; appContext?: string; }
export interface CrdCard { summary: string; indicator: string; detail?: string; links?: CrdCardLink[]; }
```

- [ ] **Step 2: Client wrapper** in `src/api/client.ts`:
```ts
export async function postCrdHook(body: {
  hook: 'order-select' | 'order-sign' | 'appointment-book';
  service_code: string; patient_id: string; plan_id: string;
}): Promise<import('../types').CrdCard[]> {
  return apiFetch<import('../types').CrdCard[]>('/crd/invoke', {
    method: 'POST', body: JSON.stringify(body),
  });
}
```

- [ ] **Step 3: Page** `src/pages/EhrOrderSimPage.tsx` — a form (hook select, service code, patient id, plan id) + a "Fire hook" button (TanStack `useMutation(postCrdHook)`), rendering returned cards. Each card with a `smart` link renders a button that `navigate('/dtr?launch=' + encodeURIComponent(link.url))` (DTR page comes from the DTR plan; until then the button can link out). Use `data-testid`: `crd-fire`, `crd-card`, `crd-dtr-launch`. Mirror the data-fetch/mutation style of `src/pages/CasePage.tsx`.

- [ ] **Step 4: Route + nav.** In `src/App.tsx` add `<Route path="/ehr-sim" element={<EhrOrderSimPage />} />`. In `LandingPage.tsx` add a button/link `navigate('/ehr-sim')` labeled "EHR Order Simulator".

- [ ] **Step 5: Mock BFF + e2e.** In `apps/web/e2e/mock-bff.ts` add a route: `url.includes('/bff/crd/invoke')` → return `[{summary:'Prior authorization required for svc-1', indicator:'warning', detail:'...', links:[{label:'Complete documentation (DTR)', url:'http://localhost:8080/dtr/launch', type:'smart', appContext:'svc-1'}]}]`. Create `e2e/ehr-sim.spec.ts`: `page.goto('/ehr-sim')`, fill the form, click `crd-fire`, assert a `crd-card` appears and `crd-dtr-launch` is visible.

- [ ] **Step 6: Verify + commit.** `cd apps/web && npm run build` (tsc+vite) → success; `npx playwright test e2e/ehr-sim.spec.ts` → green. Commit `feat(crd): web EHR order simulator page + mock-bff route + e2e`.

---

## Notes / risks
- **Tenant for real EHRs** is out of scope (pilot uses `X-Tenant-Id` from the BFF/sim). Document in code that production must map tenant from `fhirAuthorization`/registration. Do not log PHI from the hook `context`/`prefetch`.
- **CapabilityStatement / IG**: declaring CDS Hooks support is via discovery (`GET /cds-services`), not the FHIR CapabilityStatement — do not hand-edit metadata. Inferno CRD test-kit wiring is sub-project #4.
- **Parallel with DTR**: shared files this plan touches that DTR also touches — `apps/web/src/App.tsx` (routes), `LandingPage.tsx` (nav), `e2e/mock-bff.ts`, `portal-bff/main.py`, `docker-compose.yml` (interop env / depends_on). Keep edits additive and localized; the integration pass will reconcile. The DTR page (`/dtr`) is created by the DTR plan — the CRD card's launch button just navigates to it.
- Keep `interop.hapi.proxy-enabled=true` behavior intact — CRD is at `/cds-services` (not `/fhir`), so the FhirProxyFilter does not touch it.
