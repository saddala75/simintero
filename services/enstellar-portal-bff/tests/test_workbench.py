from __future__ import annotations
import uuid
from unittest.mock import AsyncMock, patch

import pytest
import respx
from httpx import AsyncClient, Response
from httpx._transports.asgi import ASGITransport

from enstellar_bff import auth as auth_module
from enstellar_bff.main import app
from enstellar_bff.clients.fhir import fhir_client

from tests.conftest import make_principal

CASE_ID = str(uuid.uuid4())


def _case_payload() -> dict:
    return {
        "case_id": CASE_ID,
        "tenant_id": "tenant-abc",
        "status": "clinical_review",
        "urgency": "standard",
        "lob": "commercial",
        "member": {"name": "Jane Smith", "dob": "1975-04-12"},
        "coverage": {},
        "service_lines": [{"service_description": "Total knee arthroplasty"}],
        "events": [],
    }


def _criterion(status: str = "met") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "criterion_id": "MED.001",
        "text": "Conservative treatment documented",
        "status": status,
        "evidence": None,
        "citations": ["InterQual 2025 §3.1"],
    }


def _suggestion() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "agent_id": "revital",
        "title": "Approve — criteria met",
        "body": "All medical necessity criteria are satisfied based on submitted records.",
        "confidence": 0.91,
        "citations": [],
        "status": "pending",
        "reviewer_id": None,
        "reviewed_at": None,
    }


def _doc() -> dict:
    return {
        "id": "doc-001",
        "title": "Clinical notes",
        "doc_type": "clinical-note",
        "content_type": "application/pdf",
        "authored": "2025-01-15",
    }


@pytest.fixture(autouse=True)
def bypass_auth():
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_workbench_returns_assembled_detail() -> None:
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}").mock(
        return_value=Response(200, json=_case_payload())
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/criteria").mock(
        return_value=Response(200, json=[_criterion("met")])
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/suggestions").mock(
        return_value=Response(200, json=[_suggestion()])
    )

    with patch.object(fhir_client, "documents", new=AsyncMock(return_value=[_doc()])):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(f"/bff/cases/{CASE_ID}/workbench")

    assert r.status_code == 200
    body = r.json()
    assert body["memberName"] == "Jane Smith"
    assert body["memberDob"] == "1975-04-12"
    assert body["serviceRequested"] == "Total knee arthroplasty"
    assert body["documentUrl"] == f"/bff/cases/{CASE_ID}/documents/doc-001/content"
    assert len(body["entities"]) == 1
    assert body["entities"][0]["status"] == "accepted"  # met → accepted
    assert body["entities"][0]["code"] == "MED.001"
    assert body["groundedness"]["gapsCount"] == 0
    assert body["summary"] == "All medical necessity criteria are satisfied based on submitted records."
    assert body["completeness"][0]["satisfied"] is True


@pytest.mark.asyncio
@respx.mock
async def test_workbench_gap_criterion_maps_to_disputed() -> None:
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}").mock(
        return_value=Response(200, json=_case_payload())
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/criteria").mock(
        return_value=Response(200, json=[_criterion("gap")])
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/suggestions").mock(
        return_value=Response(200, json=[])
    )

    with patch.object(fhir_client, "documents", new=AsyncMock(return_value=[])):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(f"/bff/cases/{CASE_ID}/workbench")

    assert r.status_code == 200
    body = r.json()
    assert body["entities"][0]["status"] == "disputed"
    assert body["groundedness"]["gapsCount"] == 1
    assert body["groundedness"]["score"] == 0.0
    assert body["summary"] == ""
    assert body["documentUrl"] is None


@pytest.mark.asyncio
@respx.mock
async def test_workbench_fhir_failure_degrades_gracefully() -> None:
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}").mock(
        return_value=Response(200, json=_case_payload())
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/criteria").mock(
        return_value=Response(200, json=[])
    )
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}/suggestions").mock(
        return_value=Response(200, json=[])
    )

    with patch.object(fhir_client, "documents", new=AsyncMock(side_effect=Exception("HAPI down"))):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(f"/bff/cases/{CASE_ID}/workbench")

    assert r.status_code == 200
    assert r.json()["documentUrl"] is None
