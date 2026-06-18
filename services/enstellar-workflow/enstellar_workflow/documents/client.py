"""DocumentServiceClient — resolves document_refs by case_ref.

The platform Document Service exposes
``GET /documents?case_ref={correlation_id}`` (tenant via the
``x-sim-tenant-id`` header), returning a JSON array of document objects
each carrying a ``doc_id``. This client turns that into a list of doc_ids
(document_refs) for the ClinicalReviewConsumer to submit to Revital.
"""
from __future__ import annotations

import httpx


class DocumentServiceClient:
    """Resolves document_refs (doc_ids) by case_ref from the Document Service."""

    def __init__(self, base_url: str) -> None:
        self._http = httpx.AsyncClient(base_url=base_url, timeout=15.0)

    async def resolve_refs(self, case_ref: str, tenant_id: str) -> list[str]:
        r = await self._http.get(
            "/documents",
            params={"case_ref": case_ref},
            headers={"x-sim-tenant-id": tenant_id},
        )
        r.raise_for_status()
        return [d["doc_id"] for d in r.json() if d.get("doc_id")]

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "DocumentServiceClient":
        return self

    async def __aexit__(self, *a: object) -> None:
        await self.close()
