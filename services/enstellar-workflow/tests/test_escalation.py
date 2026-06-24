"""Integration tests for EscalationService — requires PostgreSQL (Testcontainers)."""
import uuid

import asyncpg
import pytest

from canonical_model import Status
from tests.conftest import make_case
from enstellar_workflow.cases.repository import CaseRepository
from simintero_tenant_context import tenant_transaction
from enstellar_workflow.escalation.service import EscalationService
from enstellar_workflow.outbox.publisher import OutboxPublisher

pytestmark = pytest.mark.asyncio


async def test_escalate_from_clinical_review_updates_queue(pg_pool: asyncpg.Pool):
    """Escalating a clinical_review case sets assignee_queue='md_review'."""
    case = make_case(tenant_id="tenant-esc-01", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        result = await svc.escalate(
            conn, str(case.case_id), case.tenant_id, "user-reviewer-1", "user", reason="Needs MD"
        )

    assert result["case_id"] == str(case.case_id)
    assert result["queue"] == "md_review"

    # Verify DB column was updated
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row["assignee_queue"] == "md_review"


async def test_escalate_emits_case_assigned_outbox_event(pg_pool: asyncpg.Pool):
    """escalate() must write a case.assigned event to the outbox table."""
    case = make_case(tenant_id="tenant-esc-02", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        await svc.escalate(conn, str(case.case_id), case.tenant_id, "user-reviewer-2", "user")

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT tenant_id FROM shared.outbox"
            " WHERE envelope->'payload'->>'case_id' = $1"
            "   AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseAssigned/v1'",
            str(case.case_id),
        )
    assert row is not None, "CaseAssigned event not found in shared.outbox"
    assert row["tenant_id"] == case.tenant_id


async def test_escalate_raises_if_not_clinical_review(pg_pool: asyncpg.Pool):
    """Escalating from a non-clinical_review state must raise ValueError."""
    case = make_case(tenant_id="tenant-esc-03", status=Status.intake)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="clinical_review"):
                await svc.escalate(conn, str(case.case_id), case.tenant_id, "user-reviewer-3", "user")


async def test_escalate_raises_if_case_not_found(pg_pool: asyncpg.Pool):
    """Escalating a non-existent case_id must raise ValueError."""
    svc = EscalationService(OutboxPublisher())
    missing_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="not found"):
                await svc.escalate(conn, missing_id, "tenant-esc-04", "user-reviewer-4", "user")


async def test_breach_mode_escalates_non_clinical_review_open_case(pg_pool: asyncpg.Pool):
    """breach_mode escalates any OPEN (non-terminal) case, even non-clinical_review."""
    case = make_case(tenant_id="tenant-esc-breach-01", status=Status.pend_rfi)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        result = await svc.escalate(
            conn, str(case.case_id), case.tenant_id, "sla-monitor", "service",
            reason="sla_breach", breach_mode=True, queue="md_review",
        )

    assert result["case_id"] == str(case.case_id)
    assert result["queue"] == "md_review"
    assert result["escalated"] is True

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
        outbox = await conn.fetchrow(
            "SELECT envelope FROM shared.outbox"
            " WHERE envelope->'payload'->>'case_id' = $1"
            "   AND envelope->>'schema_ref' = 'sim.case.lifecycle/CaseAssigned/v1'",
            str(case.case_id),
        )
    assert row["assignee_queue"] == "md_review"
    assert outbox is not None, "CaseAssigned event not found in shared.outbox"
    assert outbox["envelope"] is not None


async def test_breach_mode_skips_terminal_case(pg_pool: asyncpg.Pool):
    """breach_mode is a no-op (no raise, no queue change) for a terminal case."""
    case = make_case(tenant_id="tenant-esc-breach-02", status=Status.closed)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with tenant_transaction(pg_pool, case.tenant_id) as conn:
        result = await svc.escalate(
            conn, str(case.case_id), case.tenant_id, "sla-monitor", "service",
            reason="sla_breach", breach_mode=True,
        )

    assert result["escalated"] is False
    assert result["queue"] is None
    assert result["case_id"] == str(case.case_id)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT assignee_queue FROM workflow_instances WHERE case_id=$1 AND tenant_id=$2",
            case.case_id, case.tenant_id,
        )
    assert row["assignee_queue"] != "md_review"


async def test_non_breach_mode_still_requires_clinical_review(pg_pool: asyncpg.Pool):
    """breach_mode=False (default) preserves the clinical_review ValueError guard."""
    case = make_case(tenant_id="tenant-esc-breach-03", status=Status.pend_rfi)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="clinical_review"):
                await svc.escalate(
                    conn, str(case.case_id), case.tenant_id, "user-x", "user",
                    breach_mode=False,
                )


async def test_escalate_tenant_isolation(pg_pool: asyncpg.Pool):
    """Escalating with a different tenant_id must raise ValueError (case not found)."""
    case = make_case(tenant_id="tenant-esc-05", status=Status.clinical_review)
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await repo.insert(conn, case)

    svc = EscalationService(OutboxPublisher())

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            with pytest.raises(ValueError, match="not found"):
                await svc.escalate(conn, str(case.case_id), "wrong-tenant", "user-reviewer-5", "user")
