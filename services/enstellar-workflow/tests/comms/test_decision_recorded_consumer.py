import asyncio
import uuid
import pytest
from datetime import datetime, timezone
from enstellar_events.envelope import EventEnvelope, Actor
from enstellar_events.codec import encode
from enstellar_events.topics import SchemaRef


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

    event = EventEnvelope(
        event_id=uuid.uuid4(), tenant_id=tenant_id, case_id=uuid.UUID(case_id),
        correlation_id=str(uuid.uuid4()), schema_ref=SchemaRef.DECISION_RECORDED,
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type="system"),
        payload={"outcome": "approved", "rule_artifact_id": "ra-001", "rule_version": "1.0"},
    )

    producer = AIOKafkaProducer(bootstrap_servers=kafka_bootstrap)
    await producer.start()
    await producer.send_and_wait("sim.case.lifecycle", encode(event))
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

    event = EventEnvelope(
        event_id=uuid.uuid4(), tenant_id=tenant_id, case_id=uuid.UUID(case_id),
        correlation_id=str(uuid.uuid4()), schema_ref=SchemaRef.DECISION_RECORDED,
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type="system"),
        payload={"outcome": "pending"},
    )

    # Call handle() directly — pending outcome should be skipped
    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1", tenant_id
        )
    assert count == 0
