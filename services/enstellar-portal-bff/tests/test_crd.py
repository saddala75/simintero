"""Tests for POST /bff/crd/invoke — proxies a CDS Hook to interop CRD."""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

CRD_BASE = "http://interop:8080/cds-services"


@pytest.fixture(autouse=True)
def bypass_auth():
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_invoke_returns_cards_and_forwards_tenant() -> None:
    route = respx.post(f"{CRD_BASE}/order-sign").mock(
        return_value=Response(200, json={"cards": [
            {"summary": "Prior authorization required for svc-1", "indicator": "warning",
             "detail": "Launch DTR.", "links": [
                 {"label": "Complete documentation (DTR)",
                  "url": "http://localhost:8080/dtr/launch", "type": "smart", "appContext": "svc-1"}]}
        ]})
    )
    body = {"hook": "order-sign", "service_code": "svc-1",
            "patient_id": "p1", "plan_id": "plan-1"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/bff/crd/invoke", json=body)

    assert resp.status_code == 200
    cards = resp.json()
    assert cards[0]["indicator"] == "warning"
    assert cards[0]["links"][0]["type"] == "smart"
    # tenant forwarded to interop as X-Tenant-Id
    assert route.calls.last.request.headers["X-Tenant-Id"] == "tenant-abc"


@pytest.mark.asyncio
@respx.mock
async def test_invoke_upstream_error_maps_502() -> None:
    respx.post(f"{CRD_BASE}/order-sign").mock(return_value=Response(500, json={}))
    body = {"hook": "order-sign", "service_code": "svc-1",
            "patient_id": "p1", "plan_id": "plan-1"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/bff/crd/invoke", json=body)
    assert resp.status_code == 502
