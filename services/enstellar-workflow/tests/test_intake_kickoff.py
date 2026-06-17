import json
import uuid

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.engine.transitions import TransitionRequest

from tests.conftest import make_case


async def test_create_then_kickoff_advances_to_auto_determination(pg_pool):
    svc = CaseService(pg_pool)
    case = make_case(tenant_id="tenant-dev", correlation_id=f"corr-{uuid.uuid4()}", status="intake")

    await svc.create_case(case)
    await svc.transition(
        TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state="auto_determination",
            actor_id="system",
            actor_type="system",
            correlation_id=case.correlation_id,
        )
    )

    async with pg_pool.acquire() as conn:
        status = await conn.fetchval(
            "SELECT status FROM workflow_instances WHERE case_id = $1", case.case_id
        )
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox WHERE tenant_id = $1 ORDER BY event_id",
            case.tenant_id,
        )
    assert status == "auto_determination"
    schema_refs = [json.loads(r["envelope"])["schema_ref"] for r in rows]
    assert any("CaseIntakeReceived" in s for s in schema_refs)
    assert any("CaseStateChanged" in s for s in schema_refs)


async def test_duplicate_correlation_id_does_not_raise(pg_pool):
    svc = CaseService(pg_pool)
    corr = f"corr-dup-{uuid.uuid4()}"

    # First submit
    case1 = make_case(tenant_id="tenant-dev", correlation_id=corr, status="intake")
    persisted1 = await svc.create_case(case1)
    await svc.transition(
        TransitionRequest(
            case_id=persisted1.case_id,
            tenant_id=persisted1.tenant_id,
            to_state="auto_determination",
            actor_id="system",
            actor_type="system",
            correlation_id=corr,
        )
    )

    # Duplicate submit: a NEW Case object with a DIFFERENT random case_id but the
    # SAME correlation_id (mirrors the mapper minting a fresh id every call).
    case2 = make_case(tenant_id="tenant-dev", correlation_id=corr, status="intake")
    assert case2.case_id != case1.case_id  # mapper assigns a fresh id each call
    persisted2 = await svc.create_case(case2)  # no-ops, returns the EXISTING case
    # Using the RETURNED case's id (the fix) must NOT raise:
    await svc.transition(
        TransitionRequest(
            case_id=persisted2.case_id,
            tenant_id=persisted2.tenant_id,
            to_state="auto_determination",
            actor_id="system",
            actor_type="system",
            correlation_id=corr,
        )
    )
    assert persisted2.case_id == persisted1.case_id  # returned the original persisted case
