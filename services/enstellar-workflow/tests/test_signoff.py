"""Tests for SignoffService and migration 0005 schema assertions.

Migration assertions run first (they only need pg_pool from conftest).
Service integration tests are appended in Task 2.
"""
import uuid

import asyncpg
import pytest

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.signoff.service import SignoffService
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Migration assertions (Task 1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_human_signoffs_table_exists(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'human_signoffs'"
        )
    assert row is not None, "human_signoffs table was not created by migration 0005"


@pytest.mark.asyncio
async def test_workflow_instances_has_assignee_queue(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'workflow_instances' AND column_name = 'assignee_queue'"
        )
    assert row is not None, "assignee_queue column missing from workflow_instances"


@pytest.mark.asyncio
async def test_workflow_instances_has_human_signoff_id(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'workflow_instances' AND column_name = 'human_signoff_id'"
        )
    assert row is not None, "human_signoff_id column missing from workflow_instances"


@pytest.mark.asyncio
async def test_human_signoffs_unique_constraint_on_case_tenant(pg_pool: asyncpg.Pool):
    """Inserting two signoffs for the same (case_id, tenant_id) must raise UniqueViolationError."""
    case_id = uuid.uuid4()
    tenant_id = f"tenant-dup-{uuid.uuid4()}"
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO human_signoffs (case_id, tenant_id, actor_id, actor_type, outcome_context)
                VALUES ($1, $2, 'dr-jones', 'clinician', 'denied')
                """,
                case_id, tenant_id,
            )
        with pytest.raises(asyncpg.UniqueViolationError):
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO human_signoffs (case_id, tenant_id, actor_id, actor_type, outcome_context)
                    VALUES ($1, $2, 'dr-smith', 'physician', 'denied')
                    """,
                    case_id, tenant_id,
                )


@pytest.mark.asyncio
async def test_human_signoffs_indexes_exist(pg_pool: asyncpg.Pool):
    async with pg_pool.acquire() as conn:
        for idx_name in ("ix_human_signoffs_case_id", "ix_human_signoffs_tenant_id"):
            row = await conn.fetchrow(
                "SELECT indexname FROM pg_indexes WHERE tablename = 'human_signoffs' AND indexname = $1",
                idx_name,
            )
            assert row is not None, f"index {idx_name} is missing"


# ---------------------------------------------------------------------------
# SignoffService integration tests (Task 2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_signoff_inserts_row_and_links_instance(pg_pool: asyncpg.Pool):
    """record_signoff must insert a human_signoffs row and link it from workflow_instances."""
    case = make_case(tenant_id="tenant-signoff-01")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            result = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="denied",
            )

    assert result["case_id"] == case.case_id
    assert result["tenant_id"] == case.tenant_id
    assert result["actor_id"] == "dr-jones"
    assert result["actor_type"] == "clinician"
    assert result["outcome_context"] == "denied"
    assert result["signoff_id"] is not None

    # Verify workflow_instances.human_signoff_id is set
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT human_signoff_id FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row is not None
    assert row["human_signoff_id"] == result["signoff_id"]


@pytest.mark.asyncio
async def test_has_signoff_returns_false_before_record(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-signoff-02")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), case.tenant_id)
    assert result is False


@pytest.mark.asyncio
async def test_has_signoff_returns_true_after_record(pg_pool: asyncpg.Pool):
    case = make_case(tenant_id="tenant-signoff-03")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="adverse_modification",
            )

    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), case.tenant_id)
    assert result is True


@pytest.mark.asyncio
async def test_record_signoff_upserts_on_duplicate(pg_pool: asyncpg.Pool):
    """Calling record_signoff twice for the same case must update the existing row (upsert)."""
    case = make_case(tenant_id="tenant-signoff-04")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            first = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-first",
                actor_type="clinician",
                outcome_context="denied",
            )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            second = await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-second",
                actor_type="physician",
                outcome_context="partially_denied",
            )

    # signoff_id must be the same row (upsert, not insert)
    assert first["signoff_id"] == second["signoff_id"]
    assert second["actor_id"] == "dr-second"
    assert second["outcome_context"] == "partially_denied"
    assert second["signed_at"] >= first["signed_at"]


@pytest.mark.asyncio
async def test_record_signoff_tenant_isolation(pg_pool: asyncpg.Pool):
    """has_signoff for a different tenant must return False even if same case_id."""
    case = make_case(tenant_id="tenant-signoff-05")
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = SignoffService()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await svc.record_signoff(
                conn,
                case_id=str(case.case_id),
                tenant_id=case.tenant_id,
                actor_id="dr-jones",
                actor_type="clinician",
                outcome_context="denied",
            )

    async with pg_pool.acquire() as conn:
        result = await svc.has_signoff(conn, str(case.case_id), "other-tenant")
    assert result is False


@pytest.mark.asyncio
async def test_record_signoff_raises_if_case_not_found(pg_pool: asyncpg.Pool):
    """record_signoff must raise ValueError if the workflow_instances row doesn't exist."""
    svc = SignoffService()
    missing_case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="not found"):
                await svc.record_signoff(
                    conn,
                    case_id=missing_case_id,
                    tenant_id="tenant-signoff-99",
                    actor_id="dr-jones",
                    actor_type="clinician",
                    outcome_context="denied",
                )
