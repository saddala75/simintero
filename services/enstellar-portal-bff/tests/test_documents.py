"""Tests for GET /bff/cases/{id}/documents and GET /bff/cases/{id}/documents/{doc_id}/content.

BFF proxy URL invariant: the url field in DocumentItem MUST be the BFF proxy path
(/bff/cases/{id}/documents/{doc_id}/content) — never a raw HAPI or MinIO URL.
This is tested explicitly in test_get_documents_maps_fhir_bundle.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

CASE_ID = "00000000-0000-0000-0000-000000000001"
FHIR_BASE = "http://interop:8080/fhir"


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


# ── GET /bff/cases/{id}/documents ────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_get_documents_empty_list() -> None:
    respx.get(f"{FHIR_BASE}/DocumentReference").mock(
        return_value=Response(200, json={"resourceType": "Bundle", "entry": []})
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/bff/cases/{CASE_ID}/documents")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
@respx.mock
async def test_get_documents_maps_fhir_bundle() -> None:
    respx.get(f"{FHIR_BASE}/DocumentReference").mock(
        return_value=Response(200, json={
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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/bff/cases/{CASE_ID}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    doc = docs[0]
    assert doc["id"] == "doc-1"
    assert doc["title"] == "CBC Panel"
    # BFF proxy URL — no raw HAPI/MinIO URL exposed
    assert doc["url"] == f"/bff/cases/{CASE_ID}/documents/doc-1/content"
    assert "minio.internal" not in doc["url"]


@pytest.mark.asyncio
async def test_get_documents_requires_auth() -> None:
    app.dependency_overrides.clear()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(f"/bff/cases/{CASE_ID}/documents")
        assert resp.status_code in (401, 403)
    finally:
        app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()


# ── GET /bff/cases/{id}/documents/{doc_id}/content ───────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_proxy_document_content_streams() -> None:
    doc_id = "doc-1"
    attachment_url = "https://minio.internal/bucket/doc-1.pdf"
    pdf_bytes = b"%PDF-1.4 fake content"
    respx.get(f"{FHIR_BASE}/DocumentReference/{doc_id}").mock(
        return_value=Response(200, json={
            "resourceType": "DocumentReference",
            "id": doc_id,
            "content": [{"attachment": {
                "url": attachment_url,
                "contentType": "application/pdf",
            }}],
        })
    )
    respx.get(attachment_url).mock(
        return_value=Response(200, content=pdf_bytes, headers={"content-type": "application/pdf"})
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/bff/cases/{CASE_ID}/documents/{doc_id}/content")
    assert resp.status_code == 200
    assert "application/pdf" in resp.headers["content-type"]
    assert resp.content == pdf_bytes


@pytest.mark.asyncio
@respx.mock
async def test_proxy_document_content_upstream_error_returns_502() -> None:
    doc_id = "doc-2"
    attachment_url = "https://minio.internal/bucket/doc-2.pdf"
    respx.get(f"{FHIR_BASE}/DocumentReference/{doc_id}").mock(
        return_value=Response(200, json={
            "resourceType": "DocumentReference",
            "id": doc_id,
            "content": [{"attachment": {
                "url": attachment_url,
                "contentType": "application/pdf",
            }}],
        })
    )
    # Upstream returns 404 — BFF should surface this as 502
    respx.get(attachment_url).mock(return_value=Response(404))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/bff/cases/{CASE_ID}/documents/{doc_id}/content")
    assert resp.status_code == 502


@pytest.mark.asyncio
@respx.mock
async def test_proxy_document_content_defaults_content_type() -> None:
    """When FHIR attachment has no contentType, BFF defaults to application/octet-stream."""
    doc_id = "doc-3"
    attachment_url = "https://minio.internal/bucket/doc-3.bin"
    raw_bytes = b"\x00\x01\x02\x03"
    respx.get(f"{FHIR_BASE}/DocumentReference/{doc_id}").mock(
        return_value=Response(200, json={
            "resourceType": "DocumentReference",
            "id": doc_id,
            "content": [{"attachment": {"url": attachment_url}}],
        })
    )
    respx.get(attachment_url).mock(return_value=Response(200, content=raw_bytes))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/bff/cases/{CASE_ID}/documents/{doc_id}/content")
    assert resp.status_code == 200
    assert "application/octet-stream" in resp.headers["content-type"]
    assert resp.content == raw_bytes
