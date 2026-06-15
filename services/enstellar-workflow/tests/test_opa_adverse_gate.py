"""OPA adverse-action gate tests (authoritative check, mocked via respx).

An adverse determination (denied / partially_denied / adverse_modification) must
pass BOTH the in-process guard (engine/guards.py — defense-in-depth) AND the OPA
adverse-action policy. These tests mock OPA via the autouse `opa_mock` fixture:

  - result=false  -> determination blocked (403, nothing recorded)
  - result=true   -> determination proceeds (200)

The in-process guard property tests live in test_guards.py and are untouched.
"""
import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from tests.conftest import make_case


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient wired to the Testcontainers PostgreSQL."""
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
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


async def _create_case(ac: AsyncClient):
    case = make_case()
    resp = await ac.post(
        "/cases",
        content=case.model_dump_json(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201
    return case


@pytest.mark.asyncio
async def test_opa_denies_adverse_determination_returns_403(ac: AsyncClient, pg_pool, opa_mock):
    """OPA result=false blocks an otherwise-valid adverse transition (403)."""
    opa_mock.mock(return_value=httpx.Response(200, json={"result": False}))
    case = await _create_case(ac)

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "reviewer-001",
            "actor_type": "user",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": True,  # in-process guard passes
        },
    )

    assert resp.status_code == 403, resp.text

    # The transaction must have rolled back — no denied event recorded.
    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM workflow_events "
            "WHERE case_id = $1 AND to_state = 'denied'",
            case.case_id,
        )
    assert count == 0, "OPA denied the determination but a denied event was recorded"


@pytest.mark.asyncio
async def test_opa_allows_adverse_determination_proceeds(ac: AsyncClient, opa_mock):
    """OPA result=true (the autouse default) lets the adverse transition proceed."""
    case = await _create_case(ac)

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

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "denied"


@pytest.mark.asyncio
async def test_in_process_guard_short_circuits_before_opa(ac: AsyncClient, opa_mock):
    """Adverse transition WITHOUT signoff is rejected by the in-process guard
    (409) before the OPA gate is consulted — defense-in-depth ordering."""
    opa_mock.mock(return_value=httpx.Response(200, json={"result": True}))
    case = await _create_case(ac)

    resp = await ac.post(
        f"/cases/{case.case_id}/transitions",
        json={
            "tenant_id": case.tenant_id,
            "to_state": "denied",
            "actor_id": "reviewer-001",
            "actor_type": "user",
            "correlation_id": case.correlation_id,
            "human_signoff_recorded": False,  # in-process guard blocks first
        },
    )

    assert resp.status_code == 409, resp.text
    # OPA must NOT have been called — the in-process guard short-circuited.
    assert not opa_mock.called
