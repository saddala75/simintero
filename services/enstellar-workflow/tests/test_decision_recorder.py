"""Integration tests for DecisionRecorder — requires PostgreSQL (Testcontainers).

Verifies that append_decision() correctly updates case_json['decisions'] in
workflow_instances using the targeted JSONB update.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from canonical_model.decision import Decision, Outcome
from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.decision_recorder import DecisionRecorder
from tests.conftest import make_case


def make_decision(case_id: uuid.UUID, tenant_id: str) -> Decision:
    return Decision(
        decision_id=uuid.uuid4(),
        tenant_id=tenant_id,
        case_id=case_id,
        outcome=Outcome.approved,
        decided_by="auto",
        rule_artifact_id="policy-stub-v1",
        rule_version="1.0.0",
        criteria_branch="auto-approve",
        evidence_refs=["mock-digicore"],
        human_signoff_required=False,
        human_signoff_actor=None,
        human_signoff_at=None,
        auto_approved=True,
        decided_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_append_decision_adds_decision_to_case_json(pg_pool: asyncpg.Pool):
    """append_decision() must add the Decision to case_json['decisions']."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    decision = make_decision(created.case_id, created.tenant_id)
    recorder = DecisionRecorder()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision,
            )

    # Read back the case_json and verify decisions array
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched is not None
    assert fetched.decisions is not None
    assert len(fetched.decisions) == 1
    assert fetched.decisions[0].decision_id == decision.decision_id
    assert fetched.decisions[0].outcome == Outcome.approved
    assert fetched.decisions[0].auto_approved is True
    assert fetched.decisions[0].human_signoff_required is False


@pytest.mark.asyncio
async def test_append_decision_preserves_other_case_fields(pg_pool: asyncpg.Pool):
    """append_decision() must not overwrite other fields in case_json."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-preserve")
    created = await service.create_case(case)

    decision = make_decision(created.case_id, created.tenant_id)
    recorder = DecisionRecorder()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision,
            )

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert fetched.tenant_id == "tenant-preserve"
    assert fetched.lob == created.lob
    assert fetched.member.first_name == created.member.first_name
    assert len(fetched.service_lines) == len(created.service_lines)


@pytest.mark.asyncio
async def test_append_decision_tenant_isolation(pg_pool: asyncpg.Pool):
    """append_decision() must not update a row for a different tenant_id."""
    service = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-real")
    created = await service.create_case(case)

    decision = make_decision(created.case_id, "tenant-real")
    recorder = DecisionRecorder()

    # Try to append using wrong tenant_id — must raise ValueError
    with pytest.raises(ValueError, match="No workflow_instances row found"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await recorder.append_decision(
                    conn,
                    case_id=created.case_id,
                    tenant_id="tenant-wrong",  # wrong tenant
                    decision=decision,
                )

    # Verify no decisions were written
    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, "tenant-real")

    assert fetched is not None
    assert (fetched.decisions or []) == []


@pytest.mark.asyncio
async def test_append_multiple_decisions_accumulates(pg_pool: asyncpg.Pool):
    """Multiple calls to append_decision() accumulate decisions in order."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    recorder = DecisionRecorder()
    decision1 = make_decision(created.case_id, created.tenant_id)
    decision2 = make_decision(created.case_id, created.tenant_id)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision1,
            )
        async with conn.transaction():
            await recorder.append_decision(
                conn,
                case_id=created.case_id,
                tenant_id=created.tenant_id,
                decision=decision2,
            )

    repo = CaseRepository()
    async with pg_pool.acquire() as conn:
        fetched = await repo.fetch_by_id(conn, created.case_id, created.tenant_id)

    assert len(fetched.decisions) == 2
    ids = [d.decision_id for d in fetched.decisions]
    assert decision1.decision_id in ids
    assert decision2.decision_id in ids


@pytest.mark.asyncio
async def test_append_decision_blank_tenant_id_raises_value_error(pg_pool: asyncpg.Pool):
    """INVARIANT #5: blank tenant_id raises ValueError before any SQL."""
    service = CaseService(pg_pool)
    case = make_case()
    created = await service.create_case(case)

    recorder = DecisionRecorder()
    decision = make_decision(created.case_id, created.tenant_id)

    with pytest.raises(ValueError, match="tenant_id must not be blank"):
        async with pg_pool.acquire() as conn:
            async with conn.transaction():
                await recorder.append_decision(
                    conn,
                    case_id=created.case_id,
                    tenant_id="",  # blank
                    decision=decision,
                )
