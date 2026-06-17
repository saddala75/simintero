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
