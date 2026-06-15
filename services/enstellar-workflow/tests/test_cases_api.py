"""Integration tests for the /cases FastAPI router.

CRITICAL: test_api_transition_denied_without_signoff_returns_409 is the
HTTP-layer proof of INVARIANT #1. It must never be weakened or removed.
"""
import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers PostgreSQL."""
    # Point the workflow pool at the test DB
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    # Reset singletons so the new DSN is picked up
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod

    cfg_mod._settings = None
    conn_mod._pool = None

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    await close_pool()
    conn_mod._pool = None


@pytest.mark.asyncio
async def test_post_cases_creates_case_and_returns_201(ac: AsyncClient):
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["case_id"] == str(case.case_id)
    assert data["tenant_id"] == case.tenant_id
    assert data["status"] == "intake"


@pytest.mark.asyncio
async def test_post_cases_idempotent_returns_same_case(ac: AsyncClient):
    """POST /cases with the same correlation_id returns the same case_id both times."""
    case = make_case(correlation_id=f"corr-api-idem-{uuid.uuid4()}")
    resp1 = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    resp2 = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["case_id"] == resp2.json()["case_id"]


@pytest.mark.asyncio
async def test_get_case_returns_200(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    resp = await ac.get(
        f"/cases/{case.case_id}",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert resp.status_code == 200
    assert resp.json()["case_id"] == str(case.case_id)


@pytest.mark.asyncio
async def test_get_case_returns_404_for_missing(ac: AsyncClient):
    resp = await ac.get(
        f"/cases/{uuid.uuid4()}",
        headers={"Authorization": "Bearer tenant-t08"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_case_events_returns_events_after_transition(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    transition_body = {
        "tenant_id": case.tenant_id,
        "to_state": "completeness_check",
        "actor_id": "system",
        "actor_type": "system",
        "correlation_id": case.correlation_id,
    }
    tr = await ac.post(f"/cases/{case.case_id}/transitions", json=transition_body)
    assert tr.status_code == 200

    events_resp = await ac.get(
        f"/cases/{case.case_id}/events",
        headers={"Authorization": f"Bearer {case.tenant_id}"},
    )
    assert events_resp.status_code == 200
    events = events_resp.json()
    assert len(events) >= 1
    transition_event = next(
        (e for e in events if e["to_state"] == "completeness_check"), None
    )
    assert transition_event is not None
    assert transition_event["from_state"] == "intake"


@pytest.mark.asyncio
async def test_post_transition_returns_updated_case(ac: AsyncClient):
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "completeness_check",
            "actor_id": "system",
            "actor_type": "system",
            "correlation_id": case.correlation_id,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "completeness_check"


# ============================================================
# INVARIANT #1 HTTP-LAYER PROOF — This test is SACRED.
# ============================================================


@pytest.mark.asyncio
async def test_api_transition_denied_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: POST /cases/{id}/transitions to 'denied' without human_signoff_recorded
    MUST return 409 Conflict, even when called directly via the API.

    This is the HTTP-layer proof of the adverse-transition guard. If this test
    is removed or weakened, the invariant is violated.
    """
    case = make_case()
    create_resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert create_resp.status_code == 201

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,  # <-- no sign-off
        },
    )

    assert resp.status_code == 409, (
        f"INVARIANT VIOLATED: expected 409 but got {resp.status_code}. "
        f"Response: {resp.text}"
    )
    detail = resp.json().get("detail", "")
    assert "human sign-off" in detail.lower(), (
        f"INVARIANT VIOLATED: 409 returned but error message does not mention "
        f"'human sign-off'. Got: {detail!r}"
    )


@pytest.mark.asyncio
async def test_api_transition_partially_denied_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: Same guard applies to partially_denied."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "partially_denied",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_api_transition_adverse_modification_without_signoff_returns_409(ac: AsyncClient):
    """INVARIANT #1: Same guard applies to adverse_modification."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "adverse_modification",
            "actor_id": "direct-api-caller",
            "actor_type": "service",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_api_transition_denied_with_signoff_returns_200(ac: AsyncClient):
    """Adverse transition IS allowed when human_signoff_recorded=True."""
    case = make_case()
    await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "reviewer-001",
            "actor_type": "user",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": True,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "denied"
