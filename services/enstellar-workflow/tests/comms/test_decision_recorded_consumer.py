import json
import uuid
from unittest.mock import AsyncMock, patch

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
async def test_adverse_decision_notifies_claims_service(pg_pool, kafka_bootstrap):
    """A denied DECISION_RECORDED must call claims-service /v1/internal/pa-denial
    with the correct payload after render_and_dispatch completes."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-claims-handoff-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    # Seed a denial template so render_and_dispatch succeeds
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Denied', 'Case {{ case_id }} denied')",
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
        },
    )

    mock_response = AsyncMock()
    mock_response.status_code = 200

    # Patch httpx.AsyncClient so no real HTTP call is made
    with patch(
        "enstellar_workflow.comms.consumers.decision_recorded.httpx.AsyncClient"
    ) as mock_client_cls:
        mock_client_instance = AsyncMock()
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_instance.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client_instance

        await consumer.handle(event)

    # Assert the claims-service POST was called with the right URL and payload
    mock_client_instance.post.assert_called_once()
    call_args = mock_client_instance.post.call_args
    assert "/v1/internal/pa-denial" in call_args.args[0]
    posted_body = call_args.kwargs["json"]
    assert posted_body["case_id"] == case_id
    assert posted_body["outcome"] == "denied"
    assert posted_body["reason"] == "conservative therapy not documented"
    assert posted_body["tenant_id"] == tenant_id


@pytest.mark.asyncio
async def test_claims_service_failure_does_not_block_notification(pg_pool, kafka_bootstrap):
    """If claims-service is unreachable, handle() must still complete normally
    (exception swallowed) so the Kafka offset commits and the notification fires."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    tenant_id = f"tenant-claims-fail-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Denied', 'Case {{ case_id }} denied')",
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
        payload={"case_id": case_id, "outcome": "denied"},
    )

    with patch(
        "enstellar_workflow.comms.consumers.decision_recorded.httpx.AsyncClient"
    ) as mock_client_cls:
        mock_client_instance = AsyncMock()
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_instance.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_client_cls.return_value = mock_client_instance

        # Must not raise — exception is caught and logged inside _notify_claims_service
        await consumer.handle(event)

    # The notification_log row must still exist despite the claims-service failure
    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
    assert count == 1, "notification must fire even when claims-service call fails"


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
