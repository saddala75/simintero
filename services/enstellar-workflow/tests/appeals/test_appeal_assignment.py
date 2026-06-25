"""P2 — AppealService.assign_reviewer + the COI-checked assignment route.

Assigning a reviewer to an under_review appeal:
  * stamps assigned_to / assigned_at / assigned_by on the appeals row.
  * is COI-checked: the assigned reviewer cannot be the original adverse
    determiner (the actor_id of the human `denied` transition).
  * raises AppealConflictError if the appeal is not under_review / not found.
  * the HTTP route stamps assigned_by from the authenticated assigner's `sub`
    (X-Test-Sub), NEVER from the request body.
"""
from __future__ import annotations

import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.appeals.service import (
    AppealConflictError,
    AppealService,
    COIError,
)
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.main import app
from tests.conftest import make_case

# The actor_id of the human `denied` transition driven by _drive_to below — this
# is the adverse determiner the COI check must exclude from assignment.
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


async def _setup_appeal_review(pool: asyncpg.Pool, tenant_id: str):
    """Drive a fresh case to denied then file_appeal → an under_review appeal.
    Returns (created, appeal_id)."""
    await _seed_template(pool, tenant_id, "appeal_filed")
    created = await CaseService(pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    return created, result["appeal_id"]


@pytest.mark.asyncio
async def test_assign_reviewer_stamps_columns(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-assign-{uuid.uuid4()}"
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)

    result = await AppealService(pg_pool).assign_reviewer(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        reviewer_id="dr-smith",
        assigned_by="coord-1",
    )

    assert result["assigned_to"] == "dr-smith"
    assert result["appeal_id"] == appeal_id
    assert result["status"] == "under_review"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assigned_to, assigned_by, assigned_at FROM appeals "
            "WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert row["assigned_to"] == "dr-smith"
        assert row["assigned_by"] == "coord-1"
        assert row["assigned_at"] is not None


@pytest.mark.asyncio
async def test_assign_reviewer_coi_rejects_determiner(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-assign-{uuid.uuid4()}"
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)

    with pytest.raises(COIError):
        await AppealService(pg_pool).assign_reviewer(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.UUID(appeal_id),
            reviewer_id=DETERMINER,  # the original adverse determiner
            assigned_by="coord-1",
        )

    # COI fired before the write: nothing stamped.
    async with pg_pool.acquire() as conn:
        assigned = await conn.fetchval(
            "SELECT assigned_to FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert assigned is None


@pytest.mark.asyncio
async def test_assign_reviewer_unknown_appeal_conflicts(pg_pool: asyncpg.Pool):
    tenant_id = f"tenant-assign-{uuid.uuid4()}"
    created, _appeal_id = await _setup_appeal_review(pg_pool, tenant_id)

    with pytest.raises(AppealConflictError):
        await AppealService(pg_pool).assign_reviewer(
            case_id=created.case_id,
            tenant_id=tenant_id,
            appeal_id=uuid.uuid4(),  # no such appeal
            reviewer_id="dr-smith",
            assigned_by="coord-1",
        )


# ---------------------------------------------------------------------------
# HTTP route wiring — proves the route stamps assigned_by from auth.sub.
# ---------------------------------------------------------------------------
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
async def test_assign_route_stamps_assigned_by_from_sub(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    tenant_id = f"tenant-assign-http-{uuid.uuid4()}"
    created, appeal_id = await _setup_appeal_review(pg_pool, tenant_id)

    resp = await ac.post(
        f"/cases/{created.case_id}/appeals/{appeal_id}/assignment",
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "coord-9"},
        json={"reviewer_id": "dr-smith"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["assigned_to"] == "dr-smith"

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assigned_to, assigned_by FROM appeals "
            "WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
        assert row["assigned_to"] == "dr-smith"
        # The route stamps auth.sub — NOT a body value.
        assert row["assigned_by"] == "coord-9"
