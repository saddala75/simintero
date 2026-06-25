"""P3 — POST /cases/{case_id}/close (explicit terminal close route).

Proves:
  * a settled (`denied`) case closes -> 200; workflow_instances is stamped
    status=closed / disposition=denied / closed_by = the JWT sub (X-Test-Sub),
    NOT a body value (CloseBody carries only `reason`).
  * an in-flight case (clinical_review) -> 409.
  * re-closing an already-closed case -> 409.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.main import app
from tests.conftest import make_case


async def _drive_to(pool: asyncpg.Pool, created, to_state: str) -> None:
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state=to_state,
        actor_id="reviewer-001",
        actor_type="user",
        correlation_id=str(uuid.uuid4()),
        human_signoff_recorded=True,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
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


@pytest.mark.asyncio
async def test_close_route_closes_denied_case(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-route-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")

    resp = await ac.post(
        f"/cases/{created.case_id}/close",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "ops-bob"},
        json={"reason": "window lapsed"},
    )
    assert resp.status_code == 200, resp.text

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition, closed_by FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
        assert row["status"] == "closed"
        assert row["disposition"] == "denied"
        # closed_by is the authenticated JWT sub, NOT a body value.
        assert row["closed_by"] == "ops-bob"


@pytest.mark.asyncio
async def test_close_route_in_flight_returns_409(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-route-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "clinical_review")

    resp = await ac.post(
        f"/cases/{created.case_id}/close",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "ops-bob"},
        json={"reason": "too early"},
    )
    assert resp.status_code == 409, resp.text


@pytest.mark.asyncio
async def test_close_route_reclose_returns_409(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-close-route-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")

    headers = {"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "ops-bob"}
    first = await ac.post(
        f"/cases/{created.case_id}/close", headers=headers, json={"reason": "lapsed"}
    )
    assert first.status_code == 200, first.text

    second = await ac.post(
        f"/cases/{created.case_id}/close", headers=headers, json={"reason": "again"}
    )
    assert second.status_code == 409, second.text


@pytest.mark.asyncio
async def test_closed_case_cannot_be_reopened(ac: AsyncClient, pg_pool: asyncpg.Pool):
    """`closed` is terminal — the public transitions API must reject a reopen,
    protecting the closure audit stamp + not re-emitting CaseClosed."""
    tenant_id = f"tenant-close-route-{uuid.uuid4()}"
    created = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pg_pool, created, "denied")
    await ac.post(
        f"/cases/{created.case_id}/close",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "ops-bob"},
        json={"reason": "lapsed"},
    )

    # Attempt to reopen via the generic transition API → GuardError → 409.
    resp = await ac.post(
        f"/cases/{created.case_id}/transitions",
        json={
            "tenant_id": tenant_id,
            "to_state": "clinical_review",
            "actor_id": "attacker",
            "actor_type": "user",
            "correlation_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 409, resp.text

    # The case is still closed; the audit stamp is intact.
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, disposition, closed_by FROM workflow_instances "
            "WHERE case_id=$1 AND tenant_id=$2",
            created.case_id, tenant_id,
        )
    assert row["status"] == "closed"
    assert row["disposition"] == "denied"
    assert row["closed_by"] == "ops-bob"
