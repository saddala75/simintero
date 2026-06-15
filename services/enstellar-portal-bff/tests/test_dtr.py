"""Tests for the BFF DTR router — proxies Questionnaire GET + QuestionnaireResponse POST."""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

FHIR_BASE = "http://interop:8080/fhir"


@pytest.fixture(autouse=True)
def bypass_auth():
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_get_questionnaire_returns_first_resource() -> None:
    respx.get(f"{FHIR_BASE}/Questionnaire").mock(return_value=Response(200, json={
        "resourceType": "Bundle", "entry": [
            {"resource": {"resourceType": "Questionnaire", "id": "dtr-svc-1",
                          "item": [{"linkId": "indication", "type": "string"}]}}
        ]}))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/bff/dtr/questionnaire?context=svc-1&plan=plan-1")
    assert resp.status_code == 200
    assert resp.json()["resourceType"] == "Questionnaire"


@pytest.mark.asyncio
@respx.mock
async def test_get_questionnaire_empty_is_404() -> None:
    respx.get(f"{FHIR_BASE}/Questionnaire").mock(
        return_value=Response(200, json={"resourceType": "Bundle", "entry": []}))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/bff/dtr/questionnaire?context=nope&plan=x")
    assert resp.status_code == 404


@pytest.mark.asyncio
@respx.mock
async def test_post_questionnaire_response_proxies() -> None:
    route = respx.post(f"{FHIR_BASE}/QuestionnaireResponse").mock(
        return_value=Response(201, json={"resourceType": "QuestionnaireResponse", "id": "qr-1"}))
    qr = {"resourceType": "QuestionnaireResponse", "status": "completed",
          "questionnaire": "https://enstellar.simintero.com/Questionnaire/dtr-svc-1",
          "subject": {"reference": "Patient/p1"}}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/bff/dtr/questionnaire-response", json=qr)
    assert resp.status_code == 200
    assert resp.json()["id"] == "qr-1"
    assert route.calls.last.request.headers["X-Tenant-Id"] == "tenant-abc"
