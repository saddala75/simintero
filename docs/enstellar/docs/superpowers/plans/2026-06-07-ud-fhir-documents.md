# UD — FHIR DocumentReference + Documents Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3 hardcoded document stubs in `MdContextColumn` with real `DocumentReference` FHIR resources, backed by a new HAPI resource provider and a BFF FhirClient proxy.

**Architecture:** New `DocumentReferenceResourceProvider` (HAPI `@Component`) searches `fhir_resource` (existing table) by case-id extension using JSONB containment. BFF adds a `FhirClient` that calls HAPI and returns a list of `DocumentItem`s with BFF-proxied URLs (no raw HAPI URLs in the browser). Frontend `MdContextColumn` replaces hardcoded stubs with `useQuery`.

**Tech Stack:** Java 21, Spring Boot 3.3, HAPI FHIR 7.4.0, Gradle (JVM); Python 3.12, FastAPI, httpx, respx (BFF); TypeScript, React, TanStack Query (frontend)

**Spec:** `docs/superpowers/specs/2026-06-07-ud-fhir-documents-design.md`

---

## File Map

| File | Action |
|------|--------|
| `services/interop/src/main/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProvider.java` | Create |
| `services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java` | Modify — inject + register |
| `services/interop/src/main/resources/application.yml` | Modify — capability entry |
| `services/interop/src/test/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProviderTest.java` | Create |
| `services/portal-bff/enstellar_bff/clients/fhir.py` | Create |
| `services/portal-bff/enstellar_bff/models.py` | Modify — add `DocumentItem` |
| `services/portal-bff/enstellar_bff/routers/cases.py` | Modify — add 2 routes |
| `services/portal-bff/tests/test_documents.py` | Create |
| `apps/web/src/types/index.ts` | Modify — add `DocumentItem` |
| `apps/web/src/api/client.ts` | Modify — add `getCaseDocuments` |
| `apps/web/src/pages/CasePage.tsx` | Modify — MdContextColumn |

---

## Task 1 — UD-J: HAPI DocumentReferenceResourceProvider

**Review class: sensitive (FHIR) — senior engineer review required before merge.**

**Files:**
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProvider.java`
- Modify: `services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java`
- Modify: `services/interop/src/main/resources/application.yml`
- Create: `services/interop/src/test/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProviderTest.java`

- [ ] **Step 1: Read the existing PatientResourceProvider as pattern reference**

  ```bash
  cat services/interop/src/main/java/com/simintero/enstellar/interop/providers/PatientResourceProvider.java
  ```
  Note exact imports, class structure, and how `TenantContext.require()` and `FhirResourceRepository` are used.

- [ ] **Step 2: Read HapiServerConfig.java to understand registration**

  ```bash
  cat services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java
  ```
  Note the `@Autowired` field declarations and the `List.of(...)` in `fhirServer()`.

- [ ] **Step 3: Write failing tests**

  Create `services/interop/src/test/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProviderTest.java`.

  Tests must cover:
  1. `POST /fhir/DocumentReference` creates resource, returns 201 with `Location` header.
  2. `GET /fhir/DocumentReference/{id}` returns the created resource.
  3. `GET /fhir/DocumentReference?case-id={caseId}` returns only docs matching that extension.
  4. `GET /fhir/DocumentReference?case-id={caseId}` with a different `X-Tenant-Id` returns empty Bundle.
  5. `GET /fhir/DocumentReference/{id}` with wrong tenant returns 404.

  Use the same `@SpringBootTest` / `TestRestTemplate` or `WebTestClient` pattern used in other provider tests. Check existing test structure:

  ```bash
  ls services/interop/src/test/java/com/simintero/enstellar/interop/providers/
  ```

  Example test skeleton (adapt to match existing test conventions):

  ```java
  @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
  @ActiveProfiles("test")
  class DocumentReferenceResourceProviderTest {

      @Autowired private TestRestTemplate restTemplate;
      @Autowired private FhirResourceRepository repo;
      @Autowired private FhirContext fhirContext;

      private static final String CASE_ID_EXT =
              "https://enstellar.simintero.com/fhir/StructureDefinition/case-id";
      private static final String TENANT = "test-tenant";
      private static final String OTHER_TENANT = "other-tenant";

      private DocumentReference makeDoc(String caseId) {
          DocumentReference doc = new DocumentReference();
          doc.setStatus(Enumerations.DocumentReferenceStatus.CURRENT);
          doc.addExtension(CASE_ID_EXT, new StringType(caseId));
          DocumentReference.DocumentReferenceContentComponent content =
                  doc.addContent();
          content.setAttachment(
                  new Attachment().setTitle("Test lab").setContentType("application/pdf")
          );
          return doc;
      }

      @Test void createReturns201() {
          HttpHeaders headers = new HttpHeaders();
          headers.set("X-Tenant-Id", TENANT);
          headers.setContentType(MediaType.valueOf("application/fhir+json"));
          String body = fhirContext.newJsonParser()
                  .encodeResourceToString(makeDoc("case-001"));
          ResponseEntity<String> resp = restTemplate.exchange(
                  "/fhir/DocumentReference", HttpMethod.POST,
                  new HttpEntity<>(body, headers), String.class);
          assertEquals(HttpStatus.CREATED, resp.getStatusCode());
          assertNotNull(resp.getHeaders().getLocation());
      }

      @Test void searchByCaseIdReturnsMatchingDocs() {
          // Seed two docs, different case IDs
          // Search by one case ID, assert only that one is returned
      }

      @Test void searchByCaseIdTenantIsolation() {
          // Seed doc under TENANT with a known case ID
          // Search with OTHER_TENANT header — expect empty Bundle
      }

      @Test void readWrongTenantReturns404() {
          // Create doc under TENANT
          // Read it with OTHER_TENANT header — expect 404
      }
  }
  ```

- [ ] **Step 4: Run tests — expect failure (class not compiled yet)**

  ```bash
  cd services/interop && ./gradlew test --tests "*DocumentReferenceResourceProviderTest*" 2>&1 | tail -20
  ```
  Expected: compilation failure or test failure — provider doesn't exist.

- [ ] **Step 5: Create DocumentReferenceResourceProvider.java**

  Create `services/interop/src/main/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProvider.java`:

  ```java
  package com.simintero.enstellar.interop.providers;

  import ca.uhn.fhir.context.FhirContext;
  import ca.uhn.fhir.rest.annotation.*;
  import ca.uhn.fhir.rest.api.MethodOutcome;
  import ca.uhn.fhir.rest.param.StringParam;
  import ca.uhn.fhir.rest.server.IResourceProvider;
  import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
  import com.simintero.enstellar.interop.auth.TenantContext;
  import com.simintero.enstellar.interop.persistence.FhirResourceEntity;
  import com.simintero.enstellar.interop.persistence.FhirResourceRepository;
  import org.hl7.fhir.instance.model.api.IBaseResource;
  import org.hl7.fhir.r4.model.DocumentReference;
  import org.hl7.fhir.r4.model.IdType;
  import org.springframework.beans.factory.annotation.Autowired;
  import org.springframework.stereotype.Component;

  import java.time.Instant;
  import java.util.List;
  import java.util.UUID;

  @Component
  public class DocumentReferenceResourceProvider implements IResourceProvider {

      private static final String TYPE = "DocumentReference";
      private static final String CASE_ID_EXT =
              "https://enstellar.simintero.com/fhir/StructureDefinition/case-id";

      @Autowired private FhirContext fhirContext;
      @Autowired private FhirResourceRepository repo;

      @Override
      public Class<? extends IBaseResource> getResourceType() {
          return DocumentReference.class;
      }

      @Read
      public DocumentReference read(@IdParam IdType id) {
          String tenantId = TenantContext.require();
          return repo.findByIdAndResourceTypeAndTenantId(id.getIdPart(), TYPE, tenantId)
                  .map(e -> parse(e.getResourceJson()))
                  .orElseThrow(() -> new ResourceNotFoundException(id));
      }

      @Search
      public List<DocumentReference> search(
              @OptionalParam(name = "case-id") StringParam caseId) {
          String tenantId = TenantContext.require();
          List<FhirResourceEntity> entities;
          if (caseId != null) {
              String filter = "{\"extension\":[{\"url\":\"" + CASE_ID_EXT +
                      "\",\"valueString\":\"" + esc(caseId.getValue()) + "\"}]}";
              entities = repo.searchByJsonb(TYPE, tenantId, filter);
          } else {
              entities = repo.findByResourceTypeAndTenantId(TYPE, tenantId);
          }
          return entities.stream().map(e -> parse(e.getResourceJson())).toList();
      }

      @Create
      public MethodOutcome create(@ResourceParam DocumentReference docRef) {
          String tenantId = TenantContext.require();
          String id = UUID.randomUUID().toString();
          docRef.setId(id);
          FhirResourceEntity entity = new FhirResourceEntity();
          entity.setId(id);
          entity.setResourceType(TYPE);
          entity.setTenantId(tenantId);
          entity.setResourceJson(fhirContext.newJsonParser().encodeResourceToString(docRef));
          entity.setVersionId(1L);
          entity.setCreatedAt(Instant.now());
          entity.setUpdatedAt(Instant.now());
          repo.save(entity);
          return new MethodOutcome(new IdType(TYPE, id, "1")).setCreated(true);
      }

      private DocumentReference parse(String json) {
          return fhirContext.newJsonParser().parseResource(DocumentReference.class, json);
      }

      private static String esc(String v) {
          return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
      }
  }
  ```

- [ ] **Step 6: Register in HapiServerConfig.java**

  Add field:
  ```java
  @Autowired private DocumentReferenceResourceProvider documentReferenceProvider;
  ```

  Add to `List.of(...)`:
  ```java
  server.registerProviders(List.of(
      patientProvider,
      practitionerProvider,
      coverageProvider,
      organizationProvider,
      pasSubmitProvider,
      pasInquireProvider,
      documentReferenceProvider
  ));
  ```

- [ ] **Step 7: Add capability entry to application.yml**

  Under `enstellar.fhir.capability.resources:`, add:
  ```yaml
  - type: DocumentReference
    profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference"
    interactions: [read, search-type, create]
  ```

- [ ] **Step 8: Run tests — expect pass**

  ```bash
  cd services/interop && ./gradlew test --tests "*DocumentReferenceResourceProviderTest*" 2>&1 | tail -30
  ```
  Expected: all 5 tests PASS.

- [ ] **Step 9: Run full interop test suite including conformance**

  ```bash
  ./gradlew test 2>&1 | tail -20
  ```
  Expected: no regressions in existing tests.

- [ ] **Step 10: Commit**

  ```bash
  git add services/interop/src/main/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProvider.java \
          services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java \
          services/interop/src/main/resources/application.yml \
          services/interop/src/test/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProviderTest.java
  git commit -m "feat(UD-J): HAPI DocumentReferenceResourceProvider with case-id search"
  ```

---

## Task 2 — UD1: BFF FhirClient + documents routes

**Review class: standard**

**Files:**
- Create: `services/portal-bff/enstellar_bff/clients/fhir.py`
- Modify: `services/portal-bff/enstellar_bff/models.py`
- Modify: `services/portal-bff/enstellar_bff/routers/cases.py`
- Create: `services/portal-bff/tests/test_documents.py`

- [ ] **Step 1: Check how WorkflowClient is wired to understand DI pattern**

  ```bash
  grep -n "WorkflowClient\|workflow_client\|fhir_api_url" \
    services/portal-bff/enstellar_bff/routers/cases.py \
    services/portal-bff/enstellar_bff/main.py \
    services/portal-bff/enstellar_bff/deps.py 2>/dev/null | head -20
  ```
  Note whether clients are module-level singletons or injected via `Depends`. Follow the same pattern for `FhirClient`.

- [ ] **Step 2: Check BffSettings for fhir_api_url**

  ```bash
  grep -n "fhir_api_url\|fhir" services/portal-bff/enstellar_bff/config.py 2>/dev/null || \
  grep -rn "fhir_api_url" services/portal-bff/enstellar_bff/ | head -10
  ```
  Confirm `fhir_api_url` field name in settings.

- [ ] **Step 3: Write failing tests**

  Create `services/portal-bff/tests/test_documents.py`:

  ```python
  import httpx
  import pytest

  pytestmark = pytest.mark.asyncio
  CASE_ID = "00000000-0000-0000-0000-000000000001"

  async def test_get_documents_empty_list(client, respx_mock, authed_headers):
      respx_mock.get("/DocumentReference").mock(
          return_value=httpx.Response(200, json={"resourceType": "Bundle", "entry": []})
      )
      resp = await client.get(f"/bff/cases/{CASE_ID}/documents", headers=authed_headers)
      assert resp.status_code == 200
      assert resp.json() == []

  async def test_get_documents_maps_fhir_bundle(client, respx_mock, authed_headers):
      respx_mock.get("/DocumentReference").mock(
          return_value=httpx.Response(200, json={
              "resourceType": "Bundle",
              "entry": [{"resource": {
                  "resourceType": "DocumentReference",
                  "id": "doc-1",
                  "description": "Lab report",
                  "type": {"coding": [{"display": "Lab result"}]},
                  "date": "2026-05-01",
                  "content": [{"attachment": {
                      "title": "CBC Panel",
                      "contentType": "application/pdf",
                      "url": "https://minio.internal/bucket/doc-1.pdf",
                  }}],
              }}],
          })
      )
      resp = await client.get(f"/bff/cases/{CASE_ID}/documents", headers=authed_headers)
      assert resp.status_code == 200
      docs = resp.json()
      assert len(docs) == 1
      doc = docs[0]
      assert doc["id"] == "doc-1"
      assert doc["title"] == "CBC Panel"
      # BFF proxy URL — no raw HAPI/MinIO URL exposed
      assert doc["url"] == f"/bff/cases/{CASE_ID}/documents/doc-1/content"
      assert "minio.internal" not in doc["url"]

  async def test_get_documents_requires_auth(client):
      resp = await client.get(f"/bff/cases/{CASE_ID}/documents")
      assert resp.status_code in (401, 403)

  async def test_proxy_document_content_redirects(client, respx_mock, authed_headers):
      doc_id = "doc-1"
      respx_mock.get(f"/DocumentReference/{doc_id}").mock(
          return_value=httpx.Response(200, json={
              "resourceType": "DocumentReference",
              "id": doc_id,
              "content": [{"attachment": {"url": "https://minio.internal/bucket/doc-1.pdf"}}],
          })
      )
      resp = await client.get(
          f"/bff/cases/{CASE_ID}/documents/{doc_id}/content",
          headers=authed_headers,
          follow_redirects=False,
      )
      assert resp.status_code in (302, 307)
      assert resp.headers["location"] == "https://minio.internal/bucket/doc-1.pdf"
  ```

- [ ] **Step 4: Run tests — expect failure**

  ```bash
  cd services/portal-bff && python -m pytest tests/test_documents.py -v 2>&1 | head -20
  ```
  Expected: 404 — routes don't exist.

- [ ] **Step 5: Create FhirClient**

  Create `services/portal-bff/enstellar_bff/clients/fhir.py`:

  ```python
  import httpx


  class FhirClient:
      def __init__(self, base_url: str) -> None:
          self._base = base_url.rstrip("/")

      async def documents(self, case_id: str, tenant_id: str) -> list[dict]:
          async with httpx.AsyncClient() as client:
              resp = await client.get(
                  f"{self._base}/DocumentReference",
                  params={"case-id": case_id},
                  headers={"X-Tenant-Id": tenant_id},
              )
              resp.raise_for_status()
          bundle = resp.json()
          entries = bundle.get("entry") or []
          return [_map_doc(e["resource"]) for e in entries if "resource" in e]

      async def document_by_id(self, doc_id: str, tenant_id: str) -> dict:
          async with httpx.AsyncClient() as client:
              resp = await client.get(
                  f"{self._base}/DocumentReference/{doc_id}",
                  headers={"X-Tenant-Id": tenant_id},
              )
              resp.raise_for_status()
          return resp.json()


  def _map_doc(resource: dict) -> dict:
      content = (resource.get("content") or [{}])[0]
      attachment = content.get("attachment") or {}
      type_coding = ((resource.get("type") or {}).get("coding") or [{}])[0]
      return {
          "id": resource.get("id", ""),
          "title": attachment.get("title") or resource.get("description") or "Document",
          "doc_type": type_coding.get("display") or type_coding.get("code") or "",
          "content_type": attachment.get("contentType") or "application/pdf",
          "authored": resource.get("date"),
          "_attachment_url": attachment.get("url"),
      }
  ```

- [ ] **Step 6: Add DocumentItem model**

  In `services/portal-bff/enstellar_bff/models.py`, add:

  ```python
  class DocumentItem(BaseModel):
      id: str
      title: str
      doc_type: str
      content_type: str
      url: str
      authored: str | None
  ```

- [ ] **Step 7: Add routes to cases router**

  In `services/portal-bff/enstellar_bff/routers/cases.py`, add at the top:

  ```python
  from fastapi.responses import RedirectResponse
  from enstellar_bff.clients.fhir import FhirClient
  from enstellar_bff.config import get_settings
  ```

  Instantiate `FhirClient` following the same pattern as `WorkflowClient` in this file (module-level singleton or via `Depends`):

  ```python
  fhir_client = FhirClient(get_settings().fhir_api_url)
  ```

  Add the two routes:

  ```python
  @router.get("/cases/{case_id}/documents", response_model=list[DocumentItem])
  async def get_documents(
      case_id: str,
      auth: dict = Depends(require_reviewer),
  ) -> list[DocumentItem]:
      tenant_id: str = auth["tenant_id"]
      raw_docs = await fhir_client.documents(case_id, tenant_id)
      return [
          DocumentItem(
              id=d["id"],
              title=d["title"],
              doc_type=d["doc_type"],
              content_type=d["content_type"],
              authored=d["authored"],
              url=f"/bff/cases/{case_id}/documents/{d['id']}/content",
          )
          for d in raw_docs
      ]

  @router.get("/cases/{case_id}/documents/{doc_id}/content")
  async def proxy_document_content(
      case_id: str,
      doc_id: str,
      auth: dict = Depends(require_reviewer),
  ) -> RedirectResponse:
      tenant_id: str = auth["tenant_id"]
      resource = await fhir_client.document_by_id(doc_id, tenant_id)
      content = (resource.get("content") or [{}])[0]
      attachment_url = (content.get("attachment") or {}).get("url")
      if not attachment_url:
          raise HTTPException(status_code=404, detail="No attachment URL on document")
      return RedirectResponse(url=attachment_url, status_code=302)
  ```

- [ ] **Step 8: Run tests — expect pass**

  ```bash
  python -m pytest tests/test_documents.py -v
  ```
  Expected: all 4 tests PASS.

- [ ] **Step 9: Run full BFF test suite**

  ```bash
  python -m pytest --tb=short -q
  ```
  Expected: no regressions.

- [ ] **Step 10: Commit**

  ```bash
  git add services/portal-bff/enstellar_bff/clients/fhir.py \
          services/portal-bff/enstellar_bff/models.py \
          services/portal-bff/enstellar_bff/routers/cases.py \
          services/portal-bff/tests/test_documents.py
  git commit -m "feat(UD1): BFF FhirClient + GET /bff/cases/{id}/documents"
  ```

---

## Task 3 — UD2: Wire MdContextColumn in frontend

**Review class: standard**

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/pages/CasePage.tsx`

- [ ] **Step 1: Locate hardcoded document stubs in CasePage.tsx**

  ```bash
  grep -n "hardcoded\|stub\|MdContext\|doc\|DocumentReference\|pdf" \
    apps/web/src/pages/CasePage.tsx | head -20
  ```
  Note the line range of the 3 hardcoded stubs (≈917-958) and the component name (`MdContextColumn` or similar).

- [ ] **Step 2: Add DocumentItem type**

  In `apps/web/src/types/index.ts`, add:

  ```ts
  export interface DocumentItem {
    id: string;
    title: string;
    doc_type: string;
    content_type: string;
    url: string;
    authored: string | null;
  }
  ```

- [ ] **Step 3: Add getCaseDocuments to API client**

  In `apps/web/src/api/client.ts`, add:

  ```ts
  import type { DocumentItem } from '../types';

  export function getCaseDocuments(caseId: string): Promise<DocumentItem[]> {
    return api.get(`/bff/cases/${caseId}/documents`).then(r => r.data);
  }
  ```

- [ ] **Step 4: Wire useQuery in MdContextColumn**

  In `CasePage.tsx`, find the `MdContextColumn` component or the section rendering doc stubs.

  Add the query hook:
  ```ts
  const { data: documents = [], isLoading: docsLoading } =
    useQuery(['documents', caseId], () => getCaseDocuments(caseId!));
  ```

  Remove the 3 hardcoded doc stubs. Replace with:

  ```tsx
  {docsLoading && (
    <p className="text-sm text-gray-500">Loading documents…</p>
  )}
  {!docsLoading && documents.length === 0 && (
    <p className="text-sm text-gray-400">No documents attached.</p>
  )}
  {documents.map(doc => (
    <a
      key={doc.id}
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-sm text-blue-600 hover:underline truncate"
    >
      {doc.title}
      {doc.authored && (
        <span className="text-gray-400 ml-1">({doc.authored.slice(0, 10)})</span>
      )}
    </a>
  ))}
  ```

  The `doc.url` will be `/bff/cases/{id}/documents/{docId}/content` (the BFF proxy route).

  Make sure `getCaseDocuments` is imported and `useQuery` is imported from `@tanstack/react-query`.

- [ ] **Step 5: Type-check**

  ```bash
  cd apps/web && npx tsc --noEmit 2>&1
  ```
  Expected: no type errors.

- [ ] **Step 6: Start dev server and manually verify**

  ```bash
  make up
  cd apps/web && npm run dev
  ```
  Open a case in the MD adverse view. Verify:
  1. "Loading documents…" appears briefly.
  2. Empty state shows for a case with no documents.
  3. When documents are seeded (via `POST /fhir/DocumentReference` with `case-id` extension), they appear in the list.
  4. Clicking a doc link opens the proxy URL (which redirects to the attachment).
  5. No hardcoded stubs remain.
  6. Other CasePage columns (criteria, suggestions) are unaffected.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/src/types/index.ts \
          apps/web/src/api/client.ts \
          apps/web/src/pages/CasePage.tsx
  git commit -m "feat(UD2): wire MdContextColumn to FHIR DocumentReference"
  ```
