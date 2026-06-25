"""P2 — reviewer worklist: GET /appeals/assigned.

A reviewer sees the open (under_review) appeals assigned to *them*, newest
first, tenant-isolated. The route reads the reviewer identity from auth.sub
(X-Test-Sub in tests), NEVER from the request — and only returns appeals for the
tenant the bearer token scopes.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.appeals.service import AppealService
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.main import app
from tests.conftest import make_case

DETERMINER = "reviewer-001"


async def _seed_template(pool: asyncpg.Pool, tenant_id: str, event_type: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, $2, 'portal', "
            "'Appeal', 'Appeal for case {{ case_id }} at level {{ level }}')",
            tenant_id, event_type,
        )


async def _drive_to(pool: asyncpg.Pool, created, to_state: str) -> None:
    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state=to_state,
        actor_id=DETERMINER,
        actor_type="user",
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,
    )
    async with pool.acquire() as conn:
        async with conn.transaction():
            await engine.apply(conn, req)


async def _file_and_assign(
    pool: asyncpg.Pool, tenant_id: str, reviewer_id: str
) -> str:
    """Drive a fresh case → denied → file appeal → assign to reviewer.
    Returns the appeal_id."""
    created = await CaseService(pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    appeal_id = result["appeal_id"]
    await AppealService(pool).assign_reviewer(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        reviewer_id=reviewer_id,
        assigned_by="coord-1",
    )
    return appeal_id


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers Postgres."""
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
async def test_assigned_returns_only_callers_open_appeals(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    tenant_id = f"tenant-worklist-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")

    smith_a = await _file_and_assign(pg_pool, tenant_id, "dr-smith")
    smith_b = await _file_and_assign(pg_pool, tenant_id, "dr-smith")
    _jones = await _file_and_assign(pg_pool, tenant_id, "dr-jones")

    resp = await ac.get(
        "/appeals/assigned",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-smith"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    ids = {row["appeal_id"] for row in body}
    assert ids == {smith_a, smith_b}

    # Shape: appeal_id / case_id are strings, filed_at present.
    for row in body:
        assert isinstance(row["appeal_id"], str)
        assert isinstance(row["case_id"], str)
        assert row["filed_at"] is not None
        assert row["status"] == "under_review"


@pytest.mark.asyncio
async def test_assigned_drops_appeals_no_longer_under_review(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    tenant_id = f"tenant-worklist-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")

    smith_a = await _file_and_assign(pg_pool, tenant_id, "dr-smith")
    smith_b = await _file_and_assign(pg_pool, tenant_id, "dr-smith")

    # Move one of dr-smith's appeals out of under_review (decided). Done via a
    # direct SQL status flip — decide_appeal is not yet auth-gated (Task 4) and
    # this isolates the worklist filter under test from decision-side logic.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "UPDATE appeals SET status='overturned', decided_at=now() "
            "WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(smith_a), tenant_id,
        )

    resp = await ac.get(
        "/appeals/assigned",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-smith"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["appeal_id"] for row in resp.json()}
    assert ids == {smith_b}


@pytest.mark.asyncio
async def test_assigned_is_tenant_isolated(ac: AsyncClient, pg_pool: asyncpg.Pool):
    tenant_a = f"tenant-worklist-a-{uuid.uuid4()}"
    tenant_b = f"tenant-worklist-b-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_a, "appeal_filed")
    await _seed_template(pg_pool, tenant_b, "appeal_filed")

    a_appeal = await _file_and_assign(pg_pool, tenant_a, "dr-smith")
    b_appeal = await _file_and_assign(pg_pool, tenant_b, "dr-smith")

    resp = await ac.get(
        "/appeals/assigned",
        headers={"Authorization": f"Bearer {tenant_a}", "X-Test-Sub": "dr-smith"},
    )
    assert resp.status_code == 200, resp.text
    ids = {row["appeal_id"] for row in resp.json()}
    assert ids == {a_appeal}
    assert b_appeal not in ids
