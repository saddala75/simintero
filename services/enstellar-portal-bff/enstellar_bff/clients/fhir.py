"""Async httpx client wrapping the HAPI FHIR API for DocumentReference resources.

Security invariant: _attachment_url is internal-only and never returned to the browser.
The BFF proxy URL (/bff/cases/{id}/documents/{doc_id}/content) is always used instead.
"""
from __future__ import annotations

import httpx

from enstellar_bff.config import settings


class FhirClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    async def documents(self, case_id: str, tenant_id: str) -> list[dict]:
        """Fetch DocumentReference resources by case-id extension.

        Returns a list of mapped dicts (internal representation).
        The _attachment_url key contains the raw MinIO/HAPI URL — never
        include this in BFF responses to the browser.
        """
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
        """Fetch a single DocumentReference by id."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self._base}/DocumentReference/{doc_id}",
                headers={"X-Tenant-Id": tenant_id},
            )
            resp.raise_for_status()
        return resp.json()

    async def get_questionnaire(self, context: str, plan: str, tenant_id: str) -> dict:
        """Fetch the DTR Questionnaire for a service/plan. interop returns a searchset
        Bundle; we return the first Questionnaire resource."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self._base}/Questionnaire",
                params={"context": context, "plan": plan},
                headers={"X-Tenant-Id": tenant_id, "Accept": "application/fhir+json"},
                timeout=15.0,
            )
            resp.raise_for_status()
        bundle = resp.json()
        entries = bundle.get("entry") or []
        if not entries:
            return {}
        return entries[0].get("resource", {})

    async def post_questionnaire_response(self, qr: dict, tenant_id: str) -> dict:
        """Submit a completed DTR QuestionnaireResponse (feeds the PAS pipeline in interop)."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base}/QuestionnaireResponse",
                json=qr,
                headers={"X-Tenant-Id": tenant_id, "Content-Type": "application/fhir+json"},
                timeout=15.0,
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
        "_attachment_url": attachment.get("url"),  # internal only — never returned to browser
    }


fhir_client = FhirClient(settings.fhir_api_url)
