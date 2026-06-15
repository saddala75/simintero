# DTR (Documentation Templates & Rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Da Vinci DTR `Questionnaire`(+CQL) from Digicore and accept the completed `QuestionnaireResponse`, attaching it to the PAS `$submit` bundle; provide a SMART `/dtr/launch`; and an in-house LHC-Forms renderer in `apps/web` so CRD→DTR→PAS runs end-to-end without a real EHR.

**Architecture:** DTR adds HAPI `IResourceProvider`s for `Questionnaire` (GET, fetched from the Digicore mock) and `QuestionnaireResponse` (POST → validate → assemble a PAS Bundle with the QR as supporting documentation → call the existing `PasClaimSubmitProvider.submit(Bundle)`), registered on the embedded HAPI server. Because `FhirProxyFilter` proxies all `/fhir/**` to the external HAPI, `Questionnaire` and `QuestionnaireResponse` paths are added to the proxy's `shouldNotFilter` bypass so the embedded providers handle them. `/dtr/launch` is a plain Spring `@RestController` (outside `/fhir`). CQL ships inside the Questionnaire and executes client-side (LHC-Forms); Enstellar never runs CQL.

**Tech Stack:** Java 21, HAPI FHIR R4 (structures-r4), Spring Boot; Python FastAPI (mock); FastAPI BFF (httpx); React 19 + Vite 8 + `@lhncbc/lforms`.

**Spec:** `docs/superpowers/specs/2026-06-08-dtr-service-design.md`. **Invariants:** advisory-only (serves forms / stores responses; no determination path), tenant-scoped, PHI minimum-necessary, pinned IG (Da Vinci DTR 2.0.1), client-side CQL. **Review class:** sensitive (FHIR); the PAS-bundle handoff touches the decision path → mandatory senior review.

**Verification model:** Java JUnit + WireMock/Testcontainers IT (`@Tag("integration")`, run `./gradlew :test --tests "<pat>" -PincludeIntegration`, root-scoped `:test`). Python BFF pytest+respx. Web Playwright vs the mock BFF.

**Key facts (do not re-derive):**
- interop packages under `.../interop/`: `pas/`, `config/`, `proxy/`, `auth/`. New package `dtr/`. `FhirContext` bean in `config/FhirConfig.java`. HAPI providers registered in `config/HapiServerConfig.java` via `server.registerProviders(List.of(pasSubmitProvider, pasInquireProvider))` — add the two DTR providers here.
- **PAS submit pipeline is inline in `pas/PasClaimSubmitProvider.submit(Bundle bundle)`** (validate→MinIO→normalize→DecisionStore→Kafka→ClaimResponse). It calls `TenantContext.require()` internally. `PasClaimSubmitProvider` is a `@Component` — inject it and call `.submit(bundle)` with `TenantContext` already set. Do NOT fork the pipeline. `PasBundleValidator` does not reject extra entry types, so an added `QuestionnaireResponse` entry passes.
- **`FhirProxyFilter`** (`proxy/FhirProxyFilter.java`) intercepts `/fhir/**` when `interop.hapi.proxy-enabled=true`; `shouldNotFilter` currently bypasses URIs containing `/$submit` and `/$inquire`. DTR must add bypass for `/fhir/Questionnaire` and `/fhir/QuestionnaireResponse` so the embedded providers handle them instead of proxying to the external HAPI.
- Digicore mock: `infra/compose/mocks/digicore/main.py` (FastAPI). Has `/api/v1/crd`; **add `GET /api/v1/questionnaire`** returning a raw FHIR Questionnaire dict. interop reaches it at `http://mock-digicore:8000`. The CRD plan adds the Java `DigicoreClient` + `enstellar.digicore.base-url` + `DIGICORE_BASE_URL` compose env — DTR reuses that config/base (add a method or a sibling client).
- BFF: add `dtr` router; Questionnaire/QR are under `/fhir` so use the existing `BFF_FHIR_API_URL` (`http://interop:8080/fhir`) base via the `fhir_client` pattern.
- web: `@lhncbc/lforms` is NOT a dependency (add it). It's a global JS lib rendering imperatively via `LForms.Util.addFormToPage(questionnaire, elementId, options)` — wire in a `useEffect` against a `useRef` div, single init, cleanup on unmount. Local Node v20.19.5 meets Vite 8 min. Routes in `src/App.tsx`; mock BFF `e2e/mock-bff.ts`.

**Dependency on the CRD plan:** Task 1 below (Java Digicore client/config) is created by the CRD plan's Task 1. If CRD has landed, reuse it; if building DTR's branch first, create the same `DigicoreConfig`/`DigicoreClient` (identical code) — the integration pass dedups. This plan assumes the `DigicoreClient` exists and adds a `getQuestionnaire(...)` method.

---

## Task 1: Digicore mock — Questionnaire(+CQL) endpoint

**Files:**
- Modify: `infra/compose/mocks/digicore/main.py`
- (no new deps; return a raw dict)

- [ ] **Step 1: Add the endpoint.** Append to `main.py` a representative Da Vinci DTR `Questionnaire` with an embedded CQL `Library` (contained) and a few items (boolean, choice, string) so LHC-Forms can render and prepopulate. Endpoint:
```python
@app.get("/api/v1/questionnaire")
async def get_questionnaire(service_code: str, plan_id: str, tenant_id: str) -> dict[str, Any]:
    return {
        "resourceType": "Questionnaire",
        "id": "dtr-" + service_code,
        "url": "https://enstellar.simintero.com/Questionnaire/dtr-" + service_code,
        "version": "1.0.0",
        "status": "active",
        "effectivePeriod": {"start": "2026-01-01"},
        "title": "DTR documentation for " + service_code,
        "item": [
            {"linkId": "indication", "text": "Clinical indication", "type": "string", "required": True},
            {"linkId": "tried-conservative", "text": "Conservative therapy attempted?",
             "type": "boolean", "required": True},
            {"linkId": "diagnosis", "text": "Primary diagnosis (ICD-10)", "type": "string", "required": True},
        ],
    }
```
(Keep it a literal in `main.py` so the single-file Dockerfile COPY still works. CQL can be added as a contained `Library` with base64 `content` when a richer reference is needed; for the pilot the item set is sufficient to exercise render→submit. Document that real Digicore returns the full DTR package.)

- [ ] **Step 2: Verify + commit.** `docker compose -f infra/compose/docker-compose.yml up -d --build mock-digicore`; `curl "http://localhost:8090/api/v1/questionnaire?service_code=svc-1&plan_id=plan-1&tenant_id=t1"` → 200 Questionnaire JSON. Commit `feat(dtr): Digicore mock Questionnaire endpoint`.

---

## Task 2: Java Digicore getQuestionnaire + interop config reuse

**Files:**
- Modify: `services/interop/.../crd/DigicoreClient.java` (add `getQuestionnaire`) — OR create `dtr/DigicoreQuestionnaireClient.java` if CRD's client isn't present on this branch.
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/dtr/DigicoreQuestionnaireIT.java`

- [ ] **Step 1: Add method** to `DigicoreClient` (returns the raw JSON string; DTR parses to a HAPI `Questionnaire`):
```java
public String getQuestionnaire(String serviceCode, String planId, String tenantId) {
    return webClient.get()
            .uri(uri -> uri.path("/api/v1/questionnaire")
                    .queryParam("service_code", serviceCode)
                    .queryParam("plan_id", planId)
                    .queryParam("tenant_id", tenantId)
                    .build())
            .retrieve().bodyToMono(String.class).block(java.time.Duration.ofSeconds(15));
}
```
(If CRD's `DigicoreClient` is absent on this branch, create `dtr/DigicoreConfig.java` + `dtr/DigicoreQuestionnaireClient.java` with the same base-url config; integration pass dedups.)

- [ ] **Step 2: IT** `DigicoreQuestionnaireIT.java` (extends FhirTestBase, `@Tag("integration")`, WireMock on `DIGICORE_BASE_URL`): stub `GET /api/v1/questionnaire` → the Questionnaire JSON; assert `getQuestionnaire("svc-1","plan-1","t1")` returns a string parseable by `FhirContext.forR4().newJsonParser().parseResource(Questionnaire.class, json)` with 3 items.

- [ ] **Step 3: Verify + commit.** `./gradlew :test --tests "*DigicoreQuestionnaireIT" -PincludeIntegration` → green. Commit `feat(dtr): Digicore getQuestionnaire client method`.

---

## Task 3: PasBundleAssembler (QR → PAS Bundle) — unit-tested

**Files:**
- Create: `services/interop/.../dtr/PasBundleAssembler.java`
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/dtr/PasBundleAssemblerTest.java`

- [ ] **Step 1: Write the failing test** — `PasBundleAssemblerTest.java`:
```java
package com.simintero.enstellar.interop.dtr;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PasBundleAssemblerTest {
    private final FhirContext ctx = FhirContext.forR4();
    private final PasBundleAssembler assembler = new PasBundleAssembler(ctx);

    @Test
    void wraps_questionnaire_response_into_collection_bundle_as_supporting_doc() {
        QuestionnaireResponse qr = new QuestionnaireResponse();
        qr.setStatus(QuestionnaireResponse.QuestionnaireResponseStatus.COMPLETED);
        qr.setQuestionnaire("https://enstellar.simintero.com/Questionnaire/dtr-svc-1");

        Bundle bundle = assembler.toPasBundle(qr, "svc-1", "patient-1");

        assertThat(bundle.getType()).isEqualTo(Bundle.BundleType.COLLECTION);
        // contains a Claim (preauth) and the QuestionnaireResponse
        boolean hasQr = bundle.getEntry().stream()
                .anyMatch(e -> e.getResource() instanceof QuestionnaireResponse);
        boolean hasClaim = bundle.getEntry().stream()
                .anyMatch(e -> e.getResource() instanceof Claim
                        && ((Claim) e.getResource()).getUse() == Claim.Use.PREAUTHORIZATION);
        assertThat(hasQr).isTrue();
        assertThat(hasClaim).isTrue();
    }
}
```
Run: `./gradlew :test --tests "*PasBundleAssemblerTest"` → FAIL.

- [ ] **Step 2: Implement** `PasBundleAssembler.java` — builds a `collection` Bundle containing a minimal `Claim` (use=preauthorization, with the service code as an item/productOrService coding) plus the `QuestionnaireResponse` entry (and a `Patient` reference). Construct with HAPI R4 model (mirror `PasClaimSubmitProvider.buildQueuedResponseBundle` construction style). Inject `FhirContext` via constructor. Keep it minimal but valid enough for `PasBundleValidator` (which checks for a Claim use=preauthorization + Patient/Coverage presence — read `PasBundleValidator.java` and satisfy its exact checks). Run test → PASS.

- [ ] **Step 3: Commit** `feat(dtr): PasBundleAssembler (QuestionnaireResponse -> PAS bundle)`.

---

## Task 4: DTR HAPI providers + proxy bypass + register

**Files:**
- Create: `dtr/QuestionnaireResourceProvider.java`, `dtr/QuestionnaireResponseResourceProvider.java`
- Modify: `config/HapiServerConfig.java` (register the two providers)
- Modify: `proxy/FhirProxyFilter.java` (`shouldNotFilter` bypass for Questionnaire + QuestionnaireResponse)
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/dtr/DtrProvidersIT.java`

- [ ] **Step 1: Questionnaire provider (GET / search).** `QuestionnaireResourceProvider.java` implements `IResourceProvider`, `getResourceType()` → `Questionnaire.class`. A `@Search` method with `@RequiredParam(name="context")` and `@OptionalParam(name="plan")` (and read tenant via `TenantContext.require()`): calls `digicoreClient.getQuestionnaire(context, plan, tenant)`, parses to `Questionnaire` via `FhirContext.newJsonParser().parseResource(...)`, returns it (as a single-element list / `Bundle`). Inject `DigicoreClient` + `FhirContext`.

- [ ] **Step 2: QuestionnaireResponse provider (create).** `QuestionnaireResponseResourceProvider.java`, `getResourceType()` → `QuestionnaireResponse.class`. A `@Create` method `public MethodOutcome create(@ResourceParam QuestionnaireResponse qr)`:
  - `String tenant = TenantContext.require();`
  - basic validation (status present; `questionnaire` canonical present) → else `throw new UnprocessableEntityException(...)`.
  - derive serviceCode from `qr.getQuestionnaire()` (the canonical tail) and patient from `qr.getSubject()`.
  - `Bundle pas = assembler.toPasBundle(qr, serviceCode, patientId);`
  - `pasClaimSubmitProvider.submit(pas);` (TenantContext already set on this thread by `TenantContextFilter`/conformance filter — for the embedded provider path the request is authenticated, so tenant is set).
  - return `new MethodOutcome().setResource(qr).setCreated(true)`.
  - Inject `PasBundleAssembler`, `PasClaimSubmitProvider`.

- [ ] **Step 3: Register** in `HapiServerConfig.java`: add both providers to the `registerProviders(List.of(...))` call (constructor-inject them as Spring beans, like the PAS providers).

- [ ] **Step 4: Proxy bypass.** In `proxy/FhirProxyFilter.java` `shouldNotFilter`, extend the bypass condition so URIs for Questionnaire/QuestionnaireResponse are handled by the embedded providers, not proxied:
```java
String uri = request.getRequestURI();
return uri.contains("/$submit") || uri.contains("/$inquire")
        || uri.contains("/fhir/Questionnaire");   // covers Questionnaire and QuestionnaireResponse
```
(Document why: DTR content is Digicore-sourced and DTR responses feed PAS — they are NOT stored in the external HAPI.)

- [ ] **Step 5: IT** `DtrProvidersIT.java` (extends FhirTestBase, `@Tag("integration")`; needs Digicore WireMock for the GET and the PAS pipeline deps — mirror `PasSubmitIT` Testcontainers (Kafka+MinIO) + WireMock for normalization AND digicore; set `interop.hapi.proxy-enabled=true`):
  - `get_questionnaire_returns_digicore_artifact`: stub Digicore questionnaire; `GET /fhir/Questionnaire?context=svc-1&plan=plan-1` with bearer (mintJwt tenant) → 200 Questionnaire with 3 items; assert the proxy did NOT forward it (HAPI_MOCK got 0 requests for Questionnaire).
  - `post_questionnaire_response_feeds_pas`: stub normalization + digicore; `POST /fhir/QuestionnaireResponse` with a completed QR → 201; assert the PAS pipeline ran (e.g. an intake event published / a decision record created — assert what PasSubmitIT asserts).
  - `invalid_qr_returns_422`: QR missing status/questionnaire → 422.

- [ ] **Step 6: Verify + commit.** `./gradlew :test --tests "*DtrProvidersIT" --tests "*PasBundleAssemblerTest" -PincludeIntegration` → green; also run `./gradlew :test --tests "*FhirProxyFilterIT" -PincludeIntegration` to confirm the bypass change didn't regress the proxy. Commit `feat(dtr): Questionnaire + QuestionnaireResponse providers; proxy bypass; PAS handoff`.

---

## Task 5: /dtr/launch controller

**Files:**
- Create: `dtr/DtrLaunchController.java`
- Modify: `config/SecurityConfig.java` (permitAll `/dtr/launch`)
- Test: `services/interop/src/test/java/com/simintero/enstellar/interop/dtr/DtrLaunchIT.java`

- [ ] **Step 1: Controller.** `DtrLaunchController.java` — `@RestController`, `@GetMapping("/dtr/launch")` taking `@RequestParam(required=false) String iss`, `@RequestParam(required=false) String launch`, and returning a small JSON `{ "renderer": "/dtr", "iss": iss, "launch": launch }` (the in-house renderer reads these; a real SMART launch handshake is out of scope for the pilot). Document the standard SMART launch is the production path.

- [ ] **Step 2: Security.** Add `permitAll` for `/dtr/launch` via `AntPathRequestMatcher` in `SecurityConfig` (SMART launch is reached pre-auth).

- [ ] **Step 3: IT** `DtrLaunchIT.java`: `GET /dtr/launch?iss=x&launch=y` (no token) → 200 with the JSON.

- [ ] **Step 4: Verify + commit.** `./gradlew :test --tests "*DtrLaunchIT" -PincludeIntegration` → green. Commit `feat(dtr): /dtr/launch endpoint`.

---

## Task 6: BFF dtr router

**Files:**
- Create: `services/portal-bff/enstellar_bff/routers/dtr.py`
- Modify: `enstellar_bff/clients/fhir.py` (add questionnaire GET + QR POST), `enstellar_bff/main.py` (include), `enstellar_bff/models.py` (QR submit model)
- Test: `services/portal-bff/tests/test_dtr.py`

- [ ] **Step 1: FHIR client methods** in `clients/fhir.py` (mirror existing ephemeral-httpx methods):
```python
async def get_questionnaire(self, context: str, plan: str, tenant_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{self._base}/Questionnaire",
                             params={"context": context, "plan": plan},
                             headers={"X-Tenant-Id": tenant_id,
                                      "Accept": "application/fhir+json"}, timeout=15.0)
        r.raise_for_status(); return r.json()

async def post_questionnaire_response(self, qr: dict, tenant_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{self._base}/QuestionnaireResponse", json=qr,
                             headers={"X-Tenant-Id": tenant_id,
                                      "Content-Type": "application/fhir+json"}, timeout=15.0)
        r.raise_for_status(); return r.json()
```
(Bearer/JWT to interop: the BFF authenticates the reviewer; for the FHIR calls interop requires a JWT — reuse however the existing `fhir_client` authenticates to interop today. If the existing documents flow works against interop FHIR, mirror exactly; if it relies on `BFF_DEV_BYPASS_AUTH`/a service token, follow that same mechanism. Verify against `clients/fhir.py` and the existing DocumentReference flow before implementing.)

- [ ] **Step 2: Router** `routers/dtr.py`: `APIRouter(prefix="/bff/dtr")`; `GET /questionnaire?context=&plan=` → `fhir_client.get_questionnaire(...)`; `POST /questionnaire-response` (body = raw QR dict) → `fhir_client.post_questionnaire_response(...)`. Map `httpx.HTTPStatusError` → 502/4xx. Include in `main.py`.

- [ ] **Step 3: Test** `tests/test_dtr.py` (respx stub interop `GET /fhir/Questionnaire` + `POST /fhir/QuestionnaireResponse`; `dependency_overrides[require_reviewer]`). Assert both routes proxy correctly.

- [ ] **Step 4: Verify + commit.** `cd services/portal-bff && uv run pytest tests/test_dtr.py -v` → green. Commit `feat(dtr): BFF dtr router`.

---

## Task 7: Web DTR renderer (LHC-Forms) + route + mock-bff + e2e

**Files:**
- Modify: `apps/web/package.json` (add `@lhncbc/lforms`), `apps/web/src/api/client.ts` (`getDtrQuestionnaire`, `postQuestionnaireResponse`), `apps/web/src/App.tsx` (route `/dtr`)
- Create: `apps/web/src/pages/DtrFormPage.tsx`, `apps/web/src/components/LhcForm.tsx`
- Modify: `apps/web/e2e/mock-bff.ts` (dtr routes), create `apps/web/e2e/dtr.spec.ts`

- [ ] **Step 1: Dependency.** `cd apps/web && npm install @lhncbc/lforms` (and its peer if required). Commit the lockfile change. Note: LHC-Forms ships CSS + a global `LForms`; import its CSS in the component and the lib script.

- [ ] **Step 2: LhcForm component** `src/components/LhcForm.tsx` — a React wrapper: `useRef<HTMLDivElement>`, `useEffect` that (once) calls `LForms.Util.addFormToPage(questionnaire, elRef.current.id, {prepopulate: true})` and on cleanup empties the element; exposes a `getResponse()` via `LForms.Util.getFormFHIRData('QuestionnaireResponse', 'R4', elRef.current)`. Guard for React 19 StrictMode double-invoke (init-once flag). Keep the LForms import isolated here.

- [ ] **Step 3: Client wrappers** in `src/api/client.ts`:
```ts
export async function getDtrQuestionnaire(context: string, plan: string): Promise<any> {
  return apiFetch<any>(`/dtr/questionnaire?context=${encodeURIComponent(context)}&plan=${encodeURIComponent(plan)}`);
}
export async function postQuestionnaireResponse(qr: any): Promise<any> {
  return apiFetch<any>('/dtr/questionnaire-response', { method: 'POST', body: JSON.stringify(qr) });
}
```

- [ ] **Step 4: Page** `src/pages/DtrFormPage.tsx` — reads `context`/`plan` (from query string; default to a sample), `useQuery(getDtrQuestionnaire)`, renders `<LhcForm questionnaire={data} />`, and a "Submit documentation" button that calls `getResponse()` then `useMutation(postQuestionnaireResponse)` and shows a success state. `data-testid`: `dtr-form`, `dtr-submit`, `dtr-submitted`.

- [ ] **Step 5: Route + mock-bff + e2e.** Add `<Route path="/dtr" element={<DtrFormPage />} />` in `App.tsx`. In `e2e/mock-bff.ts` add: `url.includes('/bff/dtr/questionnaire-response')` → `{resourceType:'QuestionnaireResponse', id:'qr-1'}`; `url.includes('/bff/dtr/questionnaire')` → the sample Questionnaire dict (3 items). Create `e2e/dtr.spec.ts`: `page.goto('/dtr?context=svc-1&plan=plan-1')`, wait for `dtr-form`, fill the rendered fields (or just submit if LForms renders empty), click `dtr-submit`, assert `dtr-submitted`. (If LHC-Forms is hard to drive in Playwright, assert the form container renders and the submit POST is made — keep the e2e focused on the wiring, not LForms internals.)

- [ ] **Step 6: Verify + commit.** `cd apps/web && npm run build` → success (watch for LForms/Vite ESM issues — if the global lib needs special Vite handling, configure `optimizeDeps`/a dynamic import in `LhcForm.tsx`); `npx playwright test e2e/dtr.spec.ts` → green. Commit `feat(dtr): web LHC-Forms renderer page + mock-bff + e2e`.

---

## Notes / risks
- **Proxy bypass is the critical correctness point**: without the `FhirProxyFilter.shouldNotFilter` change, `/fhir/Questionnaire` + `/fhir/QuestionnaireResponse` get proxied to the external HAPI and the DTR providers never run. Verify `FhirProxyFilterIT` still passes after the change.
- **PAS reuse, not refactor**: call `PasClaimSubmitProvider.submit(bundle)` with `TenantContext` set; do NOT extract/rewrite the decision pipeline (sacred path). The QR rides as a supporting entry; confirm `PasBundleValidator`'s exact required entries and satisfy them in `PasBundleAssembler`.
- **LHC-Forms + React 19 + Vite 8** is the biggest unknown — it's a jQuery-era global lib. Budget time for the Vite/ESM + StrictMode wiring; if it fights the build, isolate via dynamic `import()` in `LhcForm.tsx` and/or `optimizeDeps.exclude`. The e2e should assert wiring (questionnaire fetched, QR posted), not LForms rendering internals.
- **CQL** is served inside the Questionnaire and executes client-side — Enstellar never runs CQL (no engine).
- **Parallel with CRD**: shared files — `apps/web/src/App.tsx`, `e2e/mock-bff.ts`, `portal-bff/main.py`, `docker-compose.yml`, and the Java `DigicoreClient`/`enstellar.digicore` config (created by CRD Task 1). The integration pass dedups the Digicore client/config and reconciles the web routes/nav and mock-bff. The CRD card's DTR-launch button navigates to `/dtr`.
- Inferno DTR test-kit wiring is sub-project #4.
