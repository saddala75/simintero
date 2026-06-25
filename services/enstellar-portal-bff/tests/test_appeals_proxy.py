"""Tests for the thin appeals + close proxy routes (B1).

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

CASE_ID = "00000000-0000-0000-0000-000000000099"
APPEAL_ID = "11111111-1111-1111-1111-111111111111"
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
async def test_decide_appeal_forwards_bearer_and_body() -> None:
    route = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision"
    ).mock(return_value=Response(200, json={"status": "upheld"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision",
            json={
                "outcome": "upheld",
                "reason": "criteria still unmet",
                "human_signoff_recorded": True,
            },
        )

    assert r.status_code == 200
    assert r.json() == {"status": "upheld"}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {
        "outcome": "upheld",
        "reason": "criteria still unmet",
        "human_signoff_recorded": True,
    }


@pytest.mark.asyncio
@respx.mock
async def test_file_appeal_forwards_bearer_and_body() -> None:
    route = respx.post(f"{ENGINE}/cases/{CASE_ID}/appeals").mock(
        return_value=Response(201, json={"appeal_id": APPEAL_ID})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals",
            json={"filed_by": "member-001", "reason": "disagree"},
        )

    assert r.status_code == 201
    assert r.json() == {"appeal_id": APPEAL_ID}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"filed_by": "member-001", "reason": "disagree"}


@pytest.mark.asyncio
@respx.mock
async def test_list_assigned_appeals_forwards_bearer() -> None:
    route = respx.get(f"{ENGINE}/appeals/assigned").mock(
        return_value=Response(200, json=[{"appeal_id": APPEAL_ID}])
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get("/bff/appeals/assigned")

    assert r.status_code == 200
    assert r.json() == [{"appeal_id": APPEAL_ID}]
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"


@pytest.mark.asyncio
@respx.mock
async def test_close_case_forwards_reason() -> None:
    route = respx.post(f"{ENGINE}/cases/{CASE_ID}/close").mock(
        return_value=Response(200, json={"status": "closed"})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/close", json={"reason": "withdrawn"}
        )

    assert r.status_code == 200
    assert r.json() == {"status": "closed"}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"reason": "withdrawn"}


@pytest.mark.asyncio
@respx.mock
async def test_assign_appeal_reviewer_forwards_reviewer_id() -> None:
    route = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/assignment"
    ).mock(return_value=Response(200, json={"status": "assigned"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/assignment",
            json={"reviewer_id": "reviewer-007"},
        )

    assert r.status_code == 200
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"reviewer_id": "reviewer-007"}


@pytest.mark.asyncio
@respx.mock
async def test_coordinator_not_blocked_on_assignment() -> None:
    """A coordinator without the reviewer role still reaches the engine —
    the BFF is a thin proxy and never pre-blocks on role."""
    _override(["appeals_coordinator"])
    route = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/assignment"
    ).mock(return_value=Response(200, json={"status": "assigned"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/assignment",
            json={"reviewer_id": "reviewer-007"},
        )

    assert r.status_code == 200
    assert route.called


@pytest.mark.asyncio
@respx.mock
async def test_engine_409_propagates_to_bff() -> None:
    """An engine 4xx bubbles up unchanged via the Task-1 HTTPStatusError handler."""
    respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision"
    ).mock(return_value=Response(409, json={"detail": "appeal already decided"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision",
            json={"outcome": "upheld"},
        )

    assert r.status_code == 409
    assert r.json()["detail"] == "appeal already decided"
