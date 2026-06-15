# Design: UD — FHIR DocumentReference + Documents Panel (P2)

**Date:** 2026-06-07
**Phase:** P2 (UI Backend Wiring)
**Tasks:** UD-J (HAPI tier), UD1 (BFF), UD2 (web)
**Review classes:** UD-J = sensitive (FHIR); UD1/UD2 = standard

---

## Context

`CasePage.tsx` `MdContextColumn` renders 3 hardcoded document stubs (lines ≈917-958). No `DocumentReference` FHIR resource provider exists in HAPI. The `fhir_resource` table already stores all resources as JSONB and has a JSONB-containment search method. The BFF settings already have `fhir_api_url`.

The case-id extension URL `https://enstellar.simintero.com/fhir/StructureDefinition/case-id` is already in use on `ClaimResponse` — DocumentReference uses the same extension to link to a case.

---

## Architecture

```
Browser (MdContextColumn)
  └─> useQuery(['documents', caseId])
       └─> GET /bff/cases/{id}/documents
            └─> FhirClient → GET {hapi}/DocumentReference?case-id={id}
                              Header: X-Tenant-Id
                 └─> DocumentReferenceResourceProvider (HAPI @Component)
                      └─> FhirResourceRepository.searchByJsonb(
                            "DocumentReference", tenantId,
                            '{"extension":[{"url":"…case-id","valueString":"<id>"}]}'
                          )
                           └─> fhir_resource table (no new migration)

Browser (clicking a doc link)
  └─> GET /bff/cases/{id}/documents/{doc_id}/content
       └─> BFF fetches DocumentReference from HAPI
            └─> Redirects to attachment.url (MinIO presigned or content URL)
```

No new Flyway or Alembic migrations — `fhir_resource` already exists in the JVM schema.

---

## UD-J — HAPI DocumentReferenceResourceProvider

### New file

`services/interop/src/main/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProvider.java`

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

### Modify HapiServerConfig.java

```java
@Autowired private DocumentReferenceResourceProvider documentReferenceProvider;

// In fhirServer():
server.registerProviders(List.of(
    patientProvider,
    practitionerProvider,
    coverageProvider,
    organizationProvider,
    pasSubmitProvider,
    pasInquireProvider,
    documentReferenceProvider   // ← add
));
```

### Modify application.yml

Under `enstellar.fhir.capability.resources`, add:

```yaml
- type: DocumentReference
  profile: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference"
  interactions: [read, search-type, create]
```

### Test

`services/interop/src/test/java/com/simintero/enstellar/interop/providers/DocumentReferenceResourceProviderTest.java`

Tests to cover:
1. `create` returns 201 and persists to `fhir_resource` table.
2. `read` by id returns the created resource.
3. `search?case-id=` returns only documents with matching extension value.
4. `search?case-id=` with a different tenant returns empty list (tenant isolation).
5. `read` with wrong tenant returns 404.

**DoD:** all 5 tests pass; capability statement includes `DocumentReference`; conformance smoke still passes.

---

## UD1 — BFF FhirClient + routes

### New file: `services/portal-bff/enstellar_bff/clients/fhir.py`

```python
import httpx

class FhirClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    async def documents(self, case_id: str, tenant_id: str) -> list[dict]:
        url = f"{self._base}/DocumentReference"
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                url,
                params={"case-id": case_id},
                headers={"X-Tenant-Id": tenant_id},
            )
            resp.raise_for_status()
        bundle = resp.json()
        entries = bundle.get("entry") or []
        return [_map_doc(e["resource"]) for e in entries if "resource" in e]

    async def document_by_id(self, doc_id: str, tenant_id: str) -> dict:
        url = f"{self._base}/DocumentReference/{doc_id}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers={"X-Tenant-Id": tenant_id})
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
        "_attachment_url": attachment.get("url"),  # internal only, not returned to browser
    }
```

### Model

Add to `services/portal-bff/enstellar_bff/models.py`:

```python
class DocumentItem(BaseModel):
    id: str
    title: str
    doc_type: str
    content_type: str
    url: str          # BFF proxy URL — no raw HAPI URLs in browser
    authored: str | None
```

### Routes

Add to `services/portal-bff/enstellar_bff/routers/cases.py`:

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
):
    tenant_id: str = auth["tenant_id"]
    resource = await fhir_client.document_by_id(doc_id, tenant_id)
    content = (resource.get("content") or [{}])[0]
    attachment_url = (content.get("attachment") or {}).get("url")
    if not attachment_url:
        raise HTTPException(status_code=404, detail="No attachment URL on document")
    return RedirectResponse(attachment_url, status_code=302)
```

Wire `FhirClient` into the router (or via dependency injection) using `settings.fhir_api_url` from `BffSettings` (already present).

### Test

`services/portal-bff/tests/test_documents.py`:

```python
async def test_get_documents_empty_for_case_with_no_docs(client, respx_mock, authed_headers):
    case_id = "00000000-0000-0000-0000-000000000001"
    respx_mock.get(f"/DocumentReference").mock(return_value=httpx.Response(
        200, json={"resourceType": "Bundle", "entry": []}
    ))
    resp = await client.get(f"/bff/cases/{case_id}/documents", headers=authed_headers)
    assert resp.status_code == 200
    assert resp.json() == []

async def test_get_documents_maps_fhir_bundle(client, respx_mock, authed_headers):
    case_id = "00000000-0000-0000-0000-000000000001"
    respx_mock.get(f"/DocumentReference").mock(return_value=httpx.Response(200, json={
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
    }))
    resp = await client.get(f"/bff/cases/{case_id}/documents", headers=authed_headers)
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    doc = docs[0]
    assert doc["id"] == "doc-1"
    assert doc["title"] == "CBC Panel"
    assert doc["url"] == f"/bff/cases/{case_id}/documents/doc-1/content"
    assert "minio.internal" not in doc["url"]  # no raw internal URL in response

async def test_get_documents_tenant_enforced(client, respx_mock):
    case_id = "00000000-0000-0000-0000-000000000001"
    resp = await client.get(f"/bff/cases/{case_id}/documents")  # no auth
    assert resp.status_code in (401, 403)
```

**DoD:** empty list for case with no documents; real docs when seeded; BFF proxy URLs only (no raw HAPI URLs in response); tenant enforced.

---

## UD2 — Frontend: wire MdContextColumn

### Types

Add to `apps/web/src/types/index.ts`:

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

### API client

Add to `apps/web/src/api/client.ts`:

```ts
export function getCaseDocuments(caseId: string): Promise<DocumentItem[]> {
  return api.get(`/bff/cases/${caseId}/documents`).then(r => r.data);
}
```

### CasePage.tsx — MdContextColumn

Remove the 3 hardcoded document stubs (lines ≈917-958).

Add:

```tsx
const { data: documents = [], isLoading: docsLoading } =
  useQuery(['documents', caseId], () => getCaseDocuments(caseId!));
```

Replace stub rendering with:

```tsx
{docsLoading && <p className="text-sm text-gray-500">Loading documents…</p>}
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

**DoD:** document list renders from real data; empty state shown when none; clicking a link opens the BFF proxy route (no raw HAPI URL in `href`); no regression in other CasePage columns.

---

## Non-negotiable invariants

- DocumentReference resources are always scoped by `TenantContext.require()` — no cross-tenant reads. Verified by test 4 and 5 in the JVM test suite.
- No raw HAPI internal URLs exposed in the browser response — BFF proxy URL only. Verified by `test_get_documents_maps_fhir_bundle`.
- Capability statement is NOT hand-edited; it is driven by `application.yml` config and the `EnstellarCapabilityStatementProvider` — same pattern as all other resource types.
- `tenant_id` propagated on every HAPI call via `X-Tenant-Id` header, enforced by HAPI tenant interceptor.
- Review class for UD-J: **sensitive (FHIR)** — requires senior engineer review before merge.
