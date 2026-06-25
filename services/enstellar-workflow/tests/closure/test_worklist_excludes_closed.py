"""P3 — the worklist excludes closed cases (both rows and the total count).

Seeds two cases in the same named queue, closes ONE via ClosureService, then
GET /queues/{queue}/worklist returns ONLY the open case and total counts only it.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.closure.service import ClosureService
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


async def _set_queue(pool: asyncpg.Pool, case_id, tenant_id, queue: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE workflow_instances SET assignee_queue=$1 "
            "WHERE case_id=$2 AND tenant_id=$3",
            queue, case_id, tenant_id,
        )


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
async def test_worklist_excludes_closed_cases(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-wl-closed-{uuid.uuid4()}"
    queue = f"q-{uuid.uuid4().hex[:8]}"

    open_case = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _set_queue(pg_pool, open_case.case_id, tenant_id, queue)

    closed_case = await CaseService(pg_pool).create_case(make_case(tenant_id=tenant_id))
    await _set_queue(pg_pool, closed_case.case_id, tenant_id, queue)
    await _drive_to(pg_pool, closed_case, "denied")
    await ClosureService(pg_pool).close_case(
        case_id=closed_case.case_id, tenant_id=tenant_id,
        closed_by="ops-1", reason="window lapsed",
    )

    r = await ac.get(
        f"/queues/{queue}/worklist",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    ids = {item["case_id"] for item in data["items"]}

    assert str(open_case.case_id) in ids
    assert str(closed_case.case_id) not in ids
    # total counts only the open case (matches the visible rows).
    assert data["total"] == 1
