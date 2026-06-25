"""P2 (final) — decide_appeal identity + assignment gate make COI enforceable.

The decision route stamps ``reviewer_actor`` from the authenticated JWT ``sub``
(X-Test-Sub in tests), NEVER from the request body (the body field is gone).
A reviewer may only decide an appeal ASSIGNED to them (403 otherwise); the COI
check remains the backstop (409) even past the assignment gate.
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

# The actor_id of the human `denied` transition — the adverse determiner the COI
# check must exclude.
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


async def _file_appeal(pool: asyncpg.Pool, tenant_id: str) -> tuple:
    """Drive a fresh case → denied → file an appeal. Returns (created, appeal_id)."""
    created = await CaseService(pool).create_case(make_case(tenant_id=tenant_id))
    await _drive_to(pool, created, "denied")
    result = await AppealService(pool).file_appeal(
        case_id=created.case_id,
        tenant_id=tenant_id,
        filed_by="member-7",
        reason="Disagree with the denial",
    )
    return created, result["appeal_id"]


async def _assign(pool, tenant_id, created, appeal_id, reviewer_id) -> None:
    await AppealService(pool).assign_reviewer(
        case_id=created.case_id,
        tenant_id=tenant_id,
        appeal_id=uuid.UUID(appeal_id),
        reviewer_id=reviewer_id,
        assigned_by="coord-1",
    )


async def _force_assign(pool, tenant_id, appeal_id, reviewer_id) -> None:
    """Set assigned_to DIRECTLY via SQL — bypasses assign_reviewer's COI check."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE appeals SET assigned_to=$1 WHERE appeal_id=$2 AND tenant_id=$3",
            reviewer_id, uuid.UUID(appeal_id), tenant_id,
        )


async def _reviewer_actor(pool, tenant_id, appeal_id) -> str | None:
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT reviewer_actor FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )


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


def _decision_url(created, appeal_id) -> str:
    return f"/cases/{created.case_id}/appeals/{appeal_id}/decision"


@pytest.mark.asyncio
async def test_decision_reviewer_actor_is_jwt_sub(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """The written reviewer_actor is the JWT sub — NOT a body value."""
    tenant_id = f"tenant-decide-id-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _file_appeal(pg_pool, tenant_id)
    await _assign(pg_pool, tenant_id, created, appeal_id, "dr-smith")

    resp = await ac.post(
        _decision_url(created, appeal_id),
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-smith"},
        json={"outcome": "overturned"},  # NO reviewer_actor
    )

    assert resp.status_code == 200, resp.text
    assert await _reviewer_actor(pg_pool, tenant_id, appeal_id) == "dr-smith"


@pytest.mark.asyncio
async def test_decision_ignores_spoofed_reviewer_actor_in_body(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """A reviewer_actor field smuggled into the body is ignored (dropped from the
    model) — the written reviewer_actor is still the JWT sub."""
    tenant_id = f"tenant-decide-id-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _file_appeal(pg_pool, tenant_id)
    await _assign(pg_pool, tenant_id, created, appeal_id, "dr-smith")

    resp = await ac.post(
        _decision_url(created, appeal_id),
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-smith"},
        json={"outcome": "overturned", "reviewer_actor": "attacker"},
    )

    assert resp.status_code == 200, resp.text
    # The spoofed body value is ignored; the JWT sub wins.
    assert await _reviewer_actor(pg_pool, tenant_id, appeal_id) == "dr-smith"


@pytest.mark.asyncio
async def test_decision_by_non_assignee_is_forbidden(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """An appeal assigned to dr-smith, decided by dr-jones → 403; nothing written."""
    tenant_id = f"tenant-decide-id-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _file_appeal(pg_pool, tenant_id)
    await _assign(pg_pool, tenant_id, created, appeal_id, "dr-smith")

    resp = await ac.post(
        _decision_url(created, appeal_id),
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-jones"},
        json={"outcome": "overturned"},
    )

    assert resp.status_code == 403, resp.text
    # Gate fired before any write: appeal still under_review, no reviewer_actor.
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, reviewer_actor FROM appeals "
            "WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
    assert row["status"] == "under_review"
    assert row["reviewer_actor"] is None


@pytest.mark.asyncio
async def test_decision_on_unassigned_appeal_is_forbidden(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """An UNassigned appeal decided by anyone → 403."""
    tenant_id = f"tenant-decide-id-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _file_appeal(pg_pool, tenant_id)  # never assigned

    resp = await ac.post(
        _decision_url(created, appeal_id),
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": "dr-smith"},
        json={"outcome": "overturned"},
    )

    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_decision_coi_backstop_still_blocks_past_the_gate(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    """COI still fires (409) even when assigned_to == the conflicted determiner.

    Force-assign the adverse determiner directly via SQL (bypassing assign's COI),
    then decide as that determiner: the assignment gate passes (assigned_to ==
    reviewer_actor) but the COI backstop raises → 409."""
    tenant_id = f"tenant-decide-id-{uuid.uuid4()}"
    await _seed_template(pg_pool, tenant_id, "appeal_filed")
    await _seed_template(pg_pool, tenant_id, "appeal_overturned")
    created, appeal_id = await _file_appeal(pg_pool, tenant_id)
    await _force_assign(pg_pool, tenant_id, appeal_id, DETERMINER)

    resp = await ac.post(
        _decision_url(created, appeal_id),
        headers={"Authorization": f"Bearer {tenant_id}", "X-Test-Sub": DETERMINER},
        json={"outcome": "overturned"},
    )

    assert resp.status_code == 409, resp.text
    # COI aborted the tx: appeal still under_review.
    async with pg_pool.acquire() as conn:
        status = await conn.fetchval(
            "SELECT status FROM appeals WHERE appeal_id=$1 AND tenant_id=$2",
            uuid.UUID(appeal_id), tenant_id,
        )
    assert status == "under_review"
