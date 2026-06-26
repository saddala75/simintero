"""B4 e2e — member PHI sourced from case_json drives a member_phi letter.

The DecisionRecordedConsumer reads the case's member from the workflow_instances
case_json snapshot, renders the member_phi 'mail' letter WITH the member's name +
DOB, stores it in MinIO, and emits a NOTIFICATION_SENT event carrying ONLY a
body_ref (PHI provably OFF the event plane). No real MinIO — upload_notice is
monkeypatched.
"""
import json
import uuid

import pytest

from simintero_outbox import SchemaRef, make_envelope

import enstellar_workflow.comms.service as comms_service
from tests.conftest import make_case


@pytest.mark.asyncio
async def test_member_phi_letter_sources_phi_from_case_json(pg_pool, monkeypatch):
    from enstellar_workflow.cases.service import CaseService
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    uploads: list[tuple] = []

    def _fake_upload(self, tenant_id, notification_id, body):
        uploads.append((tenant_id, notification_id, body))
        return f"{self._bucket}/{tenant_id}/notices/{notification_id}.txt"

    monkeypatch.setattr(comms_service.MinioStore, "upload_notice", _fake_upload)

    tenant_id = f"phi-e2e-{uuid.uuid4()}"

    # Seed a member_phi 'mail' denied letter whose body references the member PHI.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, member_phi, subject_template, body_template) "
            "VALUES ($1, 'denied', 'mail', NULL, TRUE, 'Notice of Adverse Determination', "
            "'Dear {{ member_name }} (DOB {{ dob }}): determination of {{ outcome }}. "
            "Appeal within {{ appeal_deadline_days }} days.')",
            tenant_id,
        )

    # Build a case whose member is Jane Roe; create_case persists case_json.
    case = make_case(tenant_id=tenant_id, lob="commercial")
    member = case.member.model_copy(update={"first_name": "Jane", "last_name": "Roe"})
    case = case.model_copy(update={"member": member})
    dob = member.date_of_birth.isoformat()
    await CaseService(pg_pool).create_case(case)
    case_id = str(case.case_id)

    consumer = DecisionRecordedConsumer(pg_pool, NotificationService(OutboxPublisher()))
    event = make_envelope(
        SchemaRef.DECISION_RECORDED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={"case_id": case_id, "outcome": "denied"},
    )
    await consumer.handle(event)

    # The letter WAS rendered WITH PHI (sourced from case_json) and uploaded to MinIO.
    assert len(uploads) == 1, uploads
    _, _, uploaded_body = uploads[0]
    assert "Jane Roe" in uploaded_body, uploaded_body
    assert dob in uploaded_body, uploaded_body

    # The NOTIFICATION_SENT event for the mail channel carries ONLY a body_ref.
    async with pg_pool.acquire() as conn:
        env = await conn.fetchval(
            "SELECT envelope FROM shared.outbox "
            "WHERE tenant_id=$1 AND envelope->>'schema_ref'=$2 "
            "AND envelope->'payload'->>'case_id'=$3",
            tenant_id, SchemaRef.NOTIFICATION_SENT, case_id,
        )
    if isinstance(env, str):
        env = json.loads(env)
    payload = env["payload"]
    assert payload.get("member_phi") is True
    assert "body_ref" in payload
    assert "body" not in payload
    assert "Jane Roe" not in json.dumps(payload)
    assert dob not in json.dumps(payload)
