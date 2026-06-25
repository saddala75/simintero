"""Tests for the thin grievance proxy routes (B1).

These routes are gated by ``require_auth`` (authenticate only — no role gate);
the workflow-engine enforces the specific role on the forwarded bearer. The BFF
must be a pure pass-through: forward the bearer + body, never pre-block on role,
and propagate engine error statuses (via the Task-1 HTTPStatusError handler).
"""
from __future__ import annotations

import json

import pytest
import respx
from httpx import AsyncClient, ASGITransport, Response

import enstellar_bff.auth as auth_module
from enstellar_bff.main import app

from tests.conftest import TEST_BEARER, make_principal

GRIEVANCE_ID = "22222222-2222-2222-2222-222222222222"
CASE_ID = "00000000-0000-0000-0000-000000000099"
ENGINE = "http://workflow-engine:8000"


def _override(roles: list[str]) -> None:
    app.dependency_overrides[auth_module.require_auth] = lambda: make_principal(
        roles=roles
    )


@pytest.fixture(autouse=True)
def bypass_auth():
    _override(["reviewer"])
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_file_grievance_caseless_forwards_null_case_id() -> None:
    route = respx.post(f"{ENGINE}/grievances").mock(
        return_value=Response(201, json={"grievance_id": GRIEVANCE_ID})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/bff/grievances",
            json={
                "member_ref": "member-001",
                "filed_by": "agent-007",
                "category": "access",
                "description": "long wait times",
                "urgency": "standard",
                "lob": "medicaid",
            },
        )

    assert r.status_code == 201
    assert r.json() == {"grievance_id": GRIEVANCE_ID}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {
        "member_ref": "member-001",
        "filed_by": "agent-007",
        "case_id": None,
        "category": "access",
        "description": "long wait times",
        "urgency": "standard",
        "lob": "medicaid",
    }


@pytest.mark.asyncio
@respx.mock
async def test_file_grievance_with_case_id_forwards_it() -> None:
    route = respx.post(f"{ENGINE}/grievances").mock(
        return_value=Response(201, json={"grievance_id": GRIEVANCE_ID})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/bff/grievances",
            json={
                "member_ref": "member-001",
                "filed_by": "agent-007",
                "case_id": CASE_ID,
            },
        )

    assert r.status_code == 201
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {
        "member_ref": "member-001",
        "filed_by": "agent-007",
        "case_id": CASE_ID,
        "category": None,
        "description": None,
        "urgency": "standard",
        "lob": None,
    }


@pytest.mark.asyncio
@respx.mock
async def test_acknowledge_grievance_forwards_bearer_no_body() -> None:
    route = respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/acknowledgement").mock(
        return_value=Response(200, json={"status": "acknowledged"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(f"/bff/grievances/{GRIEVANCE_ID}/acknowledgement")

    assert r.status_code == 200
    assert r.json() == {"status": "acknowledged"}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"


@pytest.mark.asyncio
@respx.mock
async def test_assign_investigator_forwards_investigator_id() -> None:
    route = respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/assignment").mock(
        return_value=Response(200, json={"status": "assigned"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/grievances/{GRIEVANCE_ID}/assignment",
            json={"investigator_id": "investigator-009"},
        )

    assert r.status_code == 200
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"investigator_id": "investigator-009"}


@pytest.mark.asyncio
@respx.mock
async def test_resolve_grievance_forwards_resolution() -> None:
    route = respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/resolution").mock(
        return_value=Response(200, json={"status": "resolved"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/grievances/{GRIEVANCE_ID}/resolution",
            json={"resolution": "upheld and corrected"},
        )

    assert r.status_code == 200
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"resolution": "upheld and corrected"}


@pytest.mark.asyncio
@respx.mock
async def test_list_assigned_grievances_forwards_bearer() -> None:
    route = respx.get(f"{ENGINE}/grievances/assigned").mock(
        return_value=Response(200, json=[{"grievance_id": GRIEVANCE_ID}])
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/grievances/assigned")

    assert r.status_code == 200
    assert r.json() == [{"grievance_id": GRIEVANCE_ID}]
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"


@pytest.mark.asyncio
@respx.mock
async def test_coordinator_not_blocked_on_assignment() -> None:
    """A coordinator without the reviewer role still reaches the engine —
    the BFF is a thin proxy and never pre-blocks on role."""
    _override(["grievance_coordinator"])
    ack = respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/acknowledgement").mock(
        return_value=Response(200, json={"status": "acknowledged"})
    )
    assign = respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/assignment").mock(
        return_value=Response(200, json={"status": "assigned"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r_ack = await client.post(f"/bff/grievances/{GRIEVANCE_ID}/acknowledgement")
        r_assign = await client.post(
            f"/bff/grievances/{GRIEVANCE_ID}/assignment",
            json={"investigator_id": "investigator-009"},
        )

    assert r_ack.status_code == 200
    assert ack.called
    assert r_assign.status_code == 200
    assert assign.called


@pytest.mark.asyncio
@respx.mock
async def test_engine_403_propagates_to_bff() -> None:
    """An engine 4xx (not-assigned) bubbles up unchanged via the Task-1 handler."""
    respx.post(f"{ENGINE}/grievances/{GRIEVANCE_ID}/resolution").mock(
        return_value=Response(403, json={"detail": "not the assigned investigator"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/grievances/{GRIEVANCE_ID}/resolution",
            json={"resolution": "upheld"},
        )

    assert r.status_code == 403
    assert r.json()["detail"] == "not the assigned investigator"
