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
async def test_decision_notification_is_idempotent(pg_pool, kafka_bootstrap):
    """Handling the same DECISION_RECORDED event twice yields exactly ONE
    notification_log row per channel (the DB unique constraint + ON CONFLICT
    DO NOTHING is the backstop). Calling handle() directly bypasses the
    consumer's own processed_events dedupe, so this proves the DB-level guard."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-idem-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    # Seed two channels for the approved event so we can assert one row PER channel.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved'), "
            "       ($1, 'approved', 'email', 'Approved', 'Case {{ case_id }} approved')",
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
        payload={"case_id": case_id, "outcome": "approved"},
    )

    # Handle the SAME event twice.
    await consumer.handle(event)
    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT channel, COUNT(*) AS n FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type='approved' "
            "GROUP BY channel",
            tenant_id, uuid.UUID(case_id),
        )

    counts = {r["channel"]: r["n"] for r in rows}
    # Exactly one row per channel — not two.
    assert counts == {"portal": 1, "email": 1}, f"expected one row per channel, got {counts}"


@pytest.mark.asyncio
async def test_adverse_decision_renders_reason(pg_pool, kafka_bootstrap):
    """An adverse DECISION_RECORDED carrying a denial reason renders that reason
    into the notice body (the NOTIFICATION_SENT outbox payload's body)."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-adverse-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    # Seed a denied portal template whose body references the denial reason + appeal rights.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Determination', "
            "'Determination: {{ outcome }}. Reason: {{ reason }}. You have the right to appeal.')",
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
            "outcome": "denied",
            "reason": "conservative therapy not documented",
            "reason_codes": ["X"],
        },
    )

    await consumer.handle(event)

    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox WHERE tenant_id=$1", tenant_id
        )
    envelopes = [json.loads(r["envelope"]) for r in rows]
    notif = [e for e in envelopes if e["schema_ref"] == SchemaRef.NOTIFICATION_SENT]
    assert len(notif) == 1, f"expected one NOTIFICATION_SENT, got {len(notif)}"
    body = notif[0]["payload"]["body"]
    assert "conservative therapy not documented" in body, body


@pytest.mark.asyncio
async def test_adverse_decision_without_reason_still_notifies(pg_pool, kafka_bootstrap):
    """An adverse DECISION_RECORDED with NO reason key must STILL fire a notice.

    The seeded denied template guards the reason line with {% if reason %}; under
    the StrictUndefined Jinja env, an ABSENT (undefined) reason raises during
    render and silently drops the notice. The consumer must always DEFINE the
    adverse keys (None when absent) so {% if reason %} safely skips and the notice
    renders WITHOUT a reason line — exactly one notification_log row, no 'Reason:'.
    """
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-noreason-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    # Seed a denied portal template whose reason line is guarded by {% if reason %}.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Determination', "
            "'Determination: {{ outcome }}.{% if reason %} Reason: {{ reason }}.{% endif %} "
            "You have the right to appeal.')",
            tenant_id,
        )

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, service)

    # A valid 'denied' with NO reason key in the payload (signoff + OPA pass, payload={}).
    event = make_envelope(
        SchemaRef.DECISION_RECORDED,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(uuid.uuid4()),
        payload={"case_id": case_id, "outcome": "denied"},
    )

    await consumer.handle(event)

    # Exactly ONE notification_log row — the notice fired despite the absent reason.
    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
    assert count == 1, f"expected exactly one notice for reason-less denial, got {count}"

    # The rendered body must NOT contain a 'Reason:' line (reason was absent).
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox WHERE tenant_id=$1", tenant_id
        )
    envelopes = [json.loads(r["envelope"]) for r in rows]
    notif = [e for e in envelopes if e["schema_ref"] == SchemaRef.NOTIFICATION_SENT]
    assert len(notif) == 1, f"expected one NOTIFICATION_SENT, got {len(notif)}"
    body = notif[0]["payload"]["body"]
    assert "Reason:" not in body, body


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
