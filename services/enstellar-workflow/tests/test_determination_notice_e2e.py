"""End-to-end proof for Phase 3 · Slice S1 — every determination yields exactly
ONE compliant regulatory notice.

This wires the REAL path end-to-end against the suite's test DB:

    TransitionEngine.apply()  -> emits DECISION_RECORDED to shared.outbox
    (reconstruct EventEnvelope from the outbox row)
    DecisionRecordedConsumer.handle() -> renders + dispatches the notice

It proves:
  * a HUMAN adverse determination (denied) produces exactly ONE notice per
    channel carrying the denial reason + appeal-rights text;
  * a HUMAN approval produces exactly ONE notice;
  * handling the same DECISION_RECORDED twice still yields ONE row per channel
    (DB unique constraint + ON CONFLICT DO NOTHING backstop).
"""
import json
import uuid

import asyncpg
import pytest

from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef

from enstellar_workflow.cases.service import CaseService
from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
from enstellar_workflow.comms.service import NotificationService
from enstellar_workflow.engine.transitions import TransitionEngine, TransitionRequest
from enstellar_workflow.outbox.publisher import OutboxPublisher
from tests.conftest import make_case

_DECISION_RECORDED_REF = "sim.case.lifecycle/DecisionRecorded/v1"


async def _fetch_decision_recorded_envelope(
    pg_pool: asyncpg.Pool, case_id
) -> EventEnvelope:
    """Read the DECISION_RECORDED row written by apply() and reconstruct the
    platform EventEnvelope (the same envelope the live consumer would receive)."""
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox "
            "WHERE envelope->'payload'->>'case_id' = $1 "
            "AND envelope->>'schema_ref' = $2",
            str(case_id),
            _DECISION_RECORDED_REF,
        )
    assert len(rows) == 1, f"expected exactly one DECISION_RECORDED row, got {len(rows)}"
    return EventEnvelope.model_validate_json(rows[0]["envelope"])


async def _channel_counts(pg_pool: asyncpg.Pool, tenant_id, case_id, event_type) -> dict:
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT channel, COUNT(*) AS n FROM notification_log "
            "WHERE tenant_id=$1 AND case_id=$2 AND event_type=$3 "
            "GROUP BY channel",
            tenant_id, uuid.UUID(str(case_id)), event_type,
        )
    return {r["channel"]: r["n"] for r in rows}


def _notification_sent_bodies(pg_pool_rows) -> list[str]:
    envelopes = [json.loads(r["envelope"]) for r in pg_pool_rows]
    return [
        e["payload"]["body"]
        for e in envelopes
        if e["schema_ref"] == SchemaRef.NOTIFICATION_SENT
    ]


@pytest.mark.asyncio
async def test_adverse_determination_produces_one_compliant_notice(pg_pool: asyncpg.Pool):
    """HUMAN adverse determination (denied) -> exactly ONE notice per channel
    carrying the denial reason + appeal-rights; idempotent on re-handle."""
    tenant_id = f"tenant-e2e-adverse-{uuid.uuid4()}"

    # 1. Ensure a `denied` template (reason-guarded + appeal-rights) for this tenant.
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Determination on your request', "
            "'Your request received a determination of {{ outcome }}."
            "{% if reason %} Reason: {{ reason }}.{% endif %}"
            " You have the right to appeal this determination.')",
            tenant_id,
        )

    # 2. Seed a case and drive a HUMAN adverse determination to `denied`.
    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="denied",
        actor_id="reviewer-001",
        actor_type="user",  # HUMAN actor
        correlation_id=created.correlation_id,
        human_signoff_recorded=True,
        payload={
            "reason": "conservative therapy not documented",
            "reason_codes": ["X"],
            "determination_type": "denied",
        },
    )
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated, _event_id = await engine.apply(conn, req)
    assert updated.status.value == "denied"

    # 3. Reconstruct the DECISION_RECORDED envelope and hand it to the consumer.
    event = await _fetch_decision_recorded_envelope(pg_pool, created.case_id)
    assert event.payload["outcome"] == "denied"
    assert event.payload["reason"] == "conservative therapy not documented"

    publisher = OutboxPublisher()
    consumer = DecisionRecordedConsumer(pg_pool, NotificationService(publisher))
    await consumer.handle(event)

    # 4a. Exactly ONE notification_log row per channel for (case, 'denied').
    counts = await _channel_counts(pg_pool, tenant_id, created.case_id, "denied")
    assert counts == {"portal": 1}, f"expected one row per channel, got {counts}"

    # 4b. The rendered notice body carries the reason + appeal-rights text.
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT envelope FROM shared.outbox WHERE tenant_id=$1", tenant_id
        )
    bodies = _notification_sent_bodies(rows)
    assert len(bodies) == 1, f"expected one NOTIFICATION_SENT body, got {len(bodies)}"
    body = bodies[0]
    assert "conservative therapy not documented" in body, body
    assert "right to appeal" in body, body

    # 5. Idempotency: re-handling the SAME determination yields no second notice.
    await consumer.handle(event)
    counts_again = await _channel_counts(pg_pool, tenant_id, created.case_id, "denied")
    assert counts_again == {"portal": 1}, (
        f"re-handle must not produce a second notice, got {counts_again}"
    )


@pytest.mark.asyncio
async def test_human_approval_produces_notice(pg_pool: asyncpg.Pool):
    """HUMAN approval -> a DECISION_RECORDED -> exactly ONE approved notice."""
    tenant_id = f"tenant-e2e-approval-{uuid.uuid4()}"

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'approved', 'portal', 'Determination on your request', "
            "'Your request received a determination of {{ outcome }}.')",
            tenant_id,
        )

    service = CaseService(pg_pool)
    created = await service.create_case(make_case(tenant_id=tenant_id))

    engine = TransitionEngine()
    req = TransitionRequest(
        case_id=created.case_id,
        tenant_id=created.tenant_id,
        to_state="approved",
        actor_id="reviewer-001",
        actor_type="user",  # HUMAN actor
        correlation_id=created.correlation_id,
    )
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            updated, _event_id = await engine.apply(conn, req)
    assert updated.status.value == "approved"

    event = await _fetch_decision_recorded_envelope(pg_pool, created.case_id)
    assert event.payload["outcome"] == "approved"
    assert event.payload["decided_by"] == "human"

    publisher = OutboxPublisher()
    consumer = DecisionRecordedConsumer(pg_pool, NotificationService(publisher))
    await consumer.handle(event)

    counts = await _channel_counts(pg_pool, tenant_id, created.case_id, "approved")
    assert counts == {"portal": 1}, f"expected one approved notice, got {counts}"

    # Idempotent on re-handle.
    await consumer.handle(event)
    counts_again = await _channel_counts(pg_pool, tenant_id, created.case_id, "approved")
    assert counts_again == {"portal": 1}, counts_again
