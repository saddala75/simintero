"""Unit tests for DocumentServiceClient (mocked via respx).

The client resolves document_refs (doc_ids) for a case by case_ref
(= correlation_id) from the platform Document Service, forwarding the
tenant via the `x-sim-tenant-id` header.
"""
import httpx
import pytest
import respx

from enstellar_workflow.documents.client import DocumentServiceClient


@pytest.fixture(autouse=True)
def opa_mock():
    """Override the conftest autouse opa_mock for this module.

    The shared fixture registers a respx ``pass_through()`` catch-all (so OPA
    is the only mocked route and other traffic hits the network). That
    catch-all would otherwise intercept this client's request before our own
    ``@respx.mock`` route, so we disable it here — these tests mock all HTTP.
    """
    yield


@respx.mock
async def test_resolve_refs_returns_doc_ids_with_tenant_header():
    route = respx.get("http://document-service:3010/documents").mock(
        return_value=httpx.Response(200, json=[{"doc_id": "d1"}, {"doc_id": "d2"}])
    )
    async with DocumentServiceClient("http://document-service:3010") as c:
        refs = await c.resolve_refs(case_ref="corr-1", tenant_id="tenant-dev")
    assert refs == ["d1", "d2"]
    req = route.calls[0].request
    assert req.headers["x-sim-tenant-id"] == "tenant-dev"
    assert req.url.params["case_ref"] == "corr-1"


@respx.mock
async def test_resolve_refs_empty_when_none():
    respx.get("http://document-service:3010/documents").mock(
        return_value=httpx.Response(200, json=[])
    )
    async with DocumentServiceClient("http://document-service:3010") as c:
        assert await c.resolve_refs(case_ref="x", tenant_id="t") == []
