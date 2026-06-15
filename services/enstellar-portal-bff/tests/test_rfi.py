"""Tests for POST /bff/cases/{id}/rfi.

Non-negotiable invariants asserted here:
- provider_npi is fetched from the case by BFF, never from the request body.
- actor_id comes from auth["sub"], never injectable via request body.

Review class: sensitive (clocks) — senior engineer review required before merge.
"""
from __future__ import annotations

import json

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import make_principal

CASE_ID = "00000000-0000-0000-0000-000000000001"
WF_BASE = "http://workflow-engine:8000"
FIXED_SUB = "user-001"


@pytest.fixture(autouse=True)
def bypass_auth():
    """Bypass JWT validation for all tests in this module."""
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal(
        sub=FIXED_SUB
    )
    yield
    app.dependency_overrides.clear()


@respx.mock
async def test_post_rfi_proxies_and_returns_status() -> None:
    """POST /bff/cases/{id}/rfi returns 200 with status=pend_rfi."""
    respx.get(f"{WF_BASE}/cases/{CASE_ID}").mock(
        return_value=Response(200, json={"practitioner_npi": "9876543210"})
    )
    respx.post(f"{WF_BASE}/cases/{CASE_ID}/pend-rfi").mock(
        return_value=Response(
            200,
            json={"case_id": CASE_ID, "status": "pend_rfi", "rfi_request_id": "test-rfi"},
        )
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post(
            f"/bff/cases/{CASE_ID}/rfi",
            json={"question": "Please send recent labs.", "requested_docs": ["lab"]},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "pend_rfi"


@respx.mock
async def test_post_rfi_provider_npi_from_case_not_body() -> None:
    """INVARIANT: BFF must fetch provider_npi from case, never accept from request body."""
    respx.get(f"{WF_BASE}/cases/{CASE_ID}").mock(
        return_value=Response(200, json={"practitioner_npi": "CORRECT_NPI"})
    )
    captured: dict = {}

    def capture(request):
        captured["body"] = json.loads(request.content)
        return Response(200, json={"case_id": CASE_ID, "status": "pend_rfi", "rfi_request_id": "x"})

    respx.post(f"{WF_BASE}/cases/{CASE_ID}/pend-rfi").mock(side_effect=capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post(
            f"/bff/cases/{CASE_ID}/rfi",
            json={"question": "Q", "requested_docs": []},
        )

    assert captured["body"]["provider_npi"] == "CORRECT_NPI", (
        f"provider_npi must come from case record, got {captured['body'].get('provider_npi')!r}"
    )


@respx.mock
async def test_post_rfi_actor_id_from_auth_not_body() -> None:
    """INVARIANT: actor_id must come from auth['sub'], never be injectable via request body."""
    respx.get(f"{WF_BASE}/cases/{CASE_ID}").mock(
        return_value=Response(200, json={"practitioner_npi": "NPI"})
    )
    captured: dict = {}

    def capture(request):
        captured["body"] = json.loads(request.content)
        return Response(200, json={"case_id": CASE_ID, "status": "pend_rfi", "rfi_request_id": "x"})

    respx.post(f"{WF_BASE}/cases/{CASE_ID}/pend-rfi").mock(side_effect=capture)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post(
            f"/bff/cases/{CASE_ID}/rfi",
            json={"question": "Q", "requested_docs": []},
        )

    # actor_id in the downstream call must match the authenticated sub
    assert captured["body"].get("actor_id") == FIXED_SUB, (
        f"actor_id must come from auth['sub'] ({FIXED_SUB!r}), "
        f"got {captured['body'].get('actor_id')!r}"
    )


async def test_post_rfi_requires_auth() -> None:
    """Without Authorization header → 401 (require_reviewer fires before handler)."""
    app.dependency_overrides.clear()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post(
                f"/bff/cases/{CASE_ID}/rfi",
                json={"question": "Q", "requested_docs": []},
            )
        assert resp.status_code in (401, 403), (
            f"Expected 401 or 403 without auth, got {resp.status_code}"
        )
    finally:
        app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal(
            sub=FIXED_SUB
        )
