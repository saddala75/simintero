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
    # The thin routes gate on require_auth; the decision route gates on
    # require_reviewer (it records the uphold sign-off from the reviewer's sub);
    # the file route gates on require_user (any authenticated user, sub stamped).
    app.dependency_overrides[auth_module.require_auth] = lambda: make_principal(
        roles=roles
    )
    app.dependency_overrides[auth_module.require_reviewer] = lambda: make_principal(
        roles=roles
    )
    app.dependency_overrides[auth_module.require_user] = lambda: make_principal(
        roles=roles, sub="user-001"
    )


@pytest.fixture(autouse=True)
def bypass_auth():
    _override(["reviewer"])
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
@respx.mock
async def test_overturn_forwards_without_signoff() -> None:
    """An overturn (favorable) needs no sign-off → forwarded with human_signoff_recorded=False."""
    route = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision"
    ).mock(return_value=Response(200, json={"status": "overturned"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision",
            json={"outcome": "overturned", "reason": "criteria now met"},
        )

    assert r.status_code == 200
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    assert body == {"outcome": "overturned", "reason": "criteria now met",
                    "human_signoff_recorded": False}


@pytest.mark.asyncio
@respx.mock
async def test_uphold_records_signoff_serverside_and_derives_flag() -> None:
    """Upholding = continued adverse: the BFF records the sign-off server-side and
    derives human_signoff_recorded=True — it does NOT accept the flag from the body."""
    signoff = respx.post(f"{ENGINE}/cases/{CASE_ID}/human-signoff").mock(
        return_value=Response(201, json={"ok": True}))
    decide = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision"
    ).mock(return_value=Response(200, json={"status": "upheld"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision",
            # A forged human_signoff_recorded would be ignored — only sign_off_confirmed counts.
            json={"outcome": "upheld", "reason": "criteria still unmet", "sign_off_confirmed": True},
        )

    assert r.status_code == 200
    # The sign-off was recorded server-side (audit trail), keyed by the reviewer.
    assert signoff.called
    # decide_appeal is called with the DERIVED flag = True (not a client boolean).
    decide_body = json.loads(decide.calls[0].request.content)
    assert decide_body["human_signoff_recorded"] is True


@pytest.mark.asyncio
@respx.mock
async def test_uphold_without_signoff_confirmed_returns_400() -> None:
    """Upholding without sign_off_confirmed is rejected at the BFF — no engine call."""
    decide = respx.post(
        f"{ENGINE}/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision"
    ).mock(return_value=Response(200, json={"status": "upheld"}))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals/{APPEAL_ID}/decision",
            json={"outcome": "upheld"},
        )

    assert r.status_code == 400
    assert not decide.called


@pytest.mark.asyncio
@respx.mock
async def test_file_appeal_stamps_filed_by_from_sub() -> None:
    """filed_by is stamped from the authenticated sub, NOT the request body.

    The body no longer carries filed_by (B2 closes the spoofable-filed_by gap)."""
    route = respx.post(f"{ENGINE}/cases/{CASE_ID}/appeals").mock(
        return_value=Response(201, json={"appeal_id": APPEAL_ID})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals",
            json={"reason": "disagree"},  # NO filed_by in the body
        )

    assert r.status_code == 201
    assert r.json() == {"appeal_id": APPEAL_ID}
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == f"Bearer {TEST_BEARER}"
    body = json.loads(sent.content)
    # filed_by == the principal's sub (user-001), not any body value.
    assert body == {"filed_by": "user-001", "reason": "disagree"}


@pytest.mark.asyncio
@respx.mock
async def test_roleless_user_can_file_appeal() -> None:
    """Filing requires only authentication — no role. A user with NO reviewer role
    still reaches the engine, and filed_by is stamped from their sub."""
    _override([])  # no roles at all
    route = respx.post(f"{ENGINE}/cases/{CASE_ID}/appeals").mock(
        return_value=Response(201, json={"appeal_id": APPEAL_ID})
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            f"/bff/cases/{CASE_ID}/appeals",
            json={"reason": "disagree"},
        )

    assert r.status_code == 201
    assert route.called
    body = json.loads(route.calls[0].request.content)
    assert body["filed_by"] == "user-001"


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
            json={"outcome": "overturned"},  # overturn reaches the engine (no BFF sign-off gate)
        )

    assert r.status_code == 409
    assert r.json()["detail"] == "appeal already decided"
