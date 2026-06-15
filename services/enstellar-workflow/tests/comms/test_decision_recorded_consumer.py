import json
import uuid
import pytest
from simintero_outbox import SchemaRef, make_envelope


@pytest.mark.asyncio
async def test_approved_decision_triggers_notification(pg_pool, kafka_bootstrap):
    """Publish decision.recorded with outcome=approved → notification_log row inserted."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from aiokafka import AIOKafkaProducer

    tenant_id = f"tenant-notif-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    # Seed a template
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved')",
            tenant_id,
        )

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, service)

    event = make_envelope(
        SchemaRef.DECISION_RECORDED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={
            "case_id": case_id,
            "outcome": "approved",
            "rule_artifact_id": "ra-001",
            "rule_version": "1.0",
        },
    )

    producer = AIOKafkaProducer(bootstrap_servers=kafka_bootstrap)
    await producer.start()
    await producer.send_and_wait("sim.case.lifecycle", event.model_dump_json().encode("utf-8"))
    await producer.stop()

    # Process the event directly (call handle() without the full consumer loop)
    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
    assert count == 1


@pytest.mark.asyncio
async def test_notification_sent_preserves_lineage(pg_pool, kafka_bootstrap):
    """The derived NOTIFICATION_SENT envelope carries the triggering decision.recorded
    event's correlation_id and causation_id == triggering event.event_id."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-lineage-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())
    triggering_correlation_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved')",
            tenant_id,
        )

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, service)

    event = make_envelope(
        SchemaRef.DECISION_RECORDED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=triggering_correlation_id,
        payload={"case_id": case_id, "outcome": "approved"},
    )

    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox WHERE tenant_id=$1", tenant_id
        )
    envelopes = [json.loads(r["envelope"]) for r in rows]
    notif = [e for e in envelopes if e["schema_ref"] == SchemaRef.NOTIFICATION_SENT]
    assert len(notif) == 1, f"expected one NOTIFICATION_SENT, got {len(notif)}"
    emitted = notif[0]
    # Lineage: correlation preserved from the trigger, causation == trigger event_id.
    assert emitted["correlation_id"] == triggering_correlation_id
    assert emitted["causation_id"] == event.event_id


@pytest.mark.asyncio
async def test_non_terminal_outcome_skipped(pg_pool, kafka_bootstrap):
    """outcome=pending → no notification_log row."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-skip-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())
    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, service)

    event = make_envelope(
        SchemaRef.DECISION_RECORDED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={"case_id": case_id, "outcome": "pending"},
    )

    # Call handle() directly — pending outcome should be skipped
    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1", tenant_id
        )
    assert count == 0
