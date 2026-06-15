"""Tests for POST /bff/cases/{id}/adverse-decision.

Invariant covered: adverse outcomes require recorded clinician sign-off; the
endpoint must call human-signoff before transition, and must refuse (400) when
sign_off_confirmed is False.
"""
from __future__ import annotations

import json
import uuid

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

CASE_ID = "00000000-0000-0000-0000-000000000042"
WF_BASE = "http://workflow-engine:8000"


@pytest.fixture(autouse=True)
def bypass_auth():
    """Bypass JWT validation for all tests in this module; clear on teardown."""
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()
    yield
    app.dependency_overrides.clear()


@respx.mock
async def test_adverse_decision_sign_off_false_returns_400() -> None:
    """sign_off_confirmed=False must return 400 without calling workflow-engine."""
    signoff_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=Response(201, json={})
    )
    transition_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=Response(200, json={})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "denied",
                "reason": "Not medically necessary per review criteria.",
                "clinician_id": "dr-jones",
                "sign_off_confirmed": False,
            },
        )

    assert r.status_code == 400, r.text
    assert "sign_off_confirmed" in r.json().get("detail", "")
    assert not signoff_route.called
    assert not transition_route.called


@respx.mock
async def test_adverse_decision_calls_signoff_then_transition() -> None:
    """sign_off_confirmed=True → record_signoff called then transition with human_signoff_recorded=True."""
    signoff_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=Response(
            201,
            json={
                "signoff_id": str(uuid.uuid4()),
                "case_id": CASE_ID,
                "tenant_id": "tenant-abc",
                "actor_id": "dr-jones",
                "actor_type": "clinician",
                "outcome_context": "denied",
            },
        )
    )
    transition_route = respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=Response(
            200,
            json={"case_id": CASE_ID, "status": "denied"},
        )
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "denied",
                "reason": "Not medically necessary per criteria.",
                "clinician_id": "dr-jones",
                "sign_off_confirmed": True,
            },
        )

    assert r.status_code == 200, r.text
    assert signoff_route.called, "record_signoff was not called"
    assert transition_route.called, "transition was not called"

    tx_body = json.loads(transition_route.calls[0].request.content)
    assert tx_body["human_signoff_recorded"] is True
    assert tx_body["to_state"] == "denied"


@respx.mock
async def test_adverse_decision_partially_denied_outcome() -> None:
    """All three adverse states must be accepted: test partially_denied."""
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=Response(201, json={"signoff_id": str(uuid.uuid4())})
    )
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=Response(200, json={"status": "partially_denied"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "partially_denied",
                "reason": "Partial coverage approved.",
                "clinician_id": "dr-smith",
                "sign_off_confirmed": True,
            },
        )
    assert r.status_code == 200, r.text


@respx.mock
async def test_adverse_decision_adverse_modification_outcome() -> None:
    """All three adverse states must be accepted: test adverse_modification."""
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=Response(201, json={"signoff_id": str(uuid.uuid4())})
    )
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/transitions").mock(
        return_value=Response(200, json={"status": "adverse_modification"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "adverse_modification",
                "reason": "Modified approval — quantity limited.",
                "clinician_id": "dr-patel",
                "sign_off_confirmed": True,
            },
        )
    assert r.status_code == 200, r.text


async def test_adverse_decision_no_auth_returns_401() -> None:
    """Without Authorization header → 401 (HTTPBearer gate fires before handler)."""
    app.dependency_overrides.clear()
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "Test",
                    "clinician_id": "dr-jones",
                    "sign_off_confirmed": True,
                },
            )
        assert r.status_code == 401
    finally:
        app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal()


async def test_adverse_decision_invalid_outcome_returns_422() -> None:
    """outcome not in the three adverse states → 422 from Pydantic Literal validation."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.post(
            f"/bff/cases/{CASE_ID}/adverse-decision",
            json={
                "outcome": "approved",  # not an adverse state
                "reason": "Test",
                "clinician_id": "dr-jones",
                "sign_off_confirmed": True,
            },
        )
    assert r.status_code == 422
