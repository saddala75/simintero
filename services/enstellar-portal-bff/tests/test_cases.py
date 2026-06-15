"""Tests for GET /bff/cases/{id} and POST /bff/cases/{id}/decision.

Invariant covered here: submit_decision only ever issues transitions to
'approved' or 'clinical_review' — never to an adverse state.
"""
from __future__ import annotations

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

CASE_ID = "00000000-0000-0000-0000-000000000099"


def _case_payload(status: str = "clinical_review") -> dict:
    return {
        "case_id": CASE_ID,
        "tenant_id": "tenant-abc",
        "status": status,
        "urgency": "standard",
        "lob": "commercial",
        "member": {"name": "John Smith", "member_id": "MBR-001"},
        "coverage": {"plan_id": "PLN-001"},
        "service_lines": [{"procedure_code": "99213", "procedure_description": "Office Visit"}],
        "events": [{"event_type": "intake", "occurred_at": "2026-06-01T00:00:00Z"}],
    }


@pytest.fixture(autouse=True)
def bypass_auth(monkeypatch):
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_get_case_returns_case_detail() -> None:
    respx.get(f"http://workflow-engine:8000/cases/{CASE_ID}").mock(
        return_value=Response(200, json=_case_payload())
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(f"/bff/cases/{CASE_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"] == CASE_ID
    assert body["status"] == "clinical_review"
    assert body["member"]["name"] == "John Smith"
    assert len(body["service_lines"]) == 1
    assert len(body["events"]) == 1


@pytest.mark.asyncio
@respx.mock
async def test_submit_approve_transitions_to_approved() -> None:
    """Approve outcome → workflow-engine receives to_state='approved'."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "approved"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "approved", "reason": "Criteria met"},
        )
    assert r.status_code == 200
    assert transition_route.called
    sent = transition_route.calls[0].request
    import json
    body = json.loads(sent.content)
    assert body["to_state"] == "approved"
    assert body["human_signoff_recorded"] is True
    assert body["payload"]["reason"] == "Criteria met"


@pytest.mark.asyncio
@respx.mock
async def test_submit_escalate_transitions_to_clinical_review() -> None:
    """Escalate outcome → workflow-engine receives to_state='clinical_review'."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "clinical_review"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "escalate"},
        )
    assert r.status_code == 200
    import json
    body = json.loads(transition_route.calls[0].request.content)
    assert body["to_state"] == "clinical_review"
    assert body["human_signoff_recorded"] is True


@pytest.mark.asyncio
@respx.mock
async def test_submit_decision_always_sets_human_signoff_recorded() -> None:
    """human_signoff_recorded is always True — never False from this endpoint."""
    transition_route = respx.post(
        f"http://workflow-engine:8000/cases/{CASE_ID}/transitions"
    ).mock(return_value=Response(200, json={"status": "approved"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post(
            f"/bff/cases/{CASE_ID}/decision",
            json={"outcome": "approved"},
        )
    import json
    body = json.loads(transition_route.calls[0].request.content)
    assert body["human_signoff_recorded"] is True


@pytest.mark.asyncio
async def test_non_reviewer_role_returns_403(monkeypatch) -> None:
    """A token without reviewer role must not reach the decision endpoint."""
    app.dependency_overrides[auth_module.require_reviewer] = (
        lambda: (_ for _ in ()).throw(
            __import__("fastapi").HTTPException(status_code=403, detail="reviewer role required")
        )
    )
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/bff/cases/{CASE_ID}/decision",
                json={"outcome": "approved"},
            )
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
