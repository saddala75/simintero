"""End-to-end proof that the DecisionRecordedConsumer threads the case's LOB
into notice selection: an MA denial renders the MA-specific template (65-day
appeal window) while a commercial denial falls back to the generic template
(180-day window). The consumer reads the case's lob from workflow_instances,
so the two notices DIFFER for the same outcome.
"""
import json
import uuid

import pytest

from simintero_outbox import SchemaRef, make_envelope

from tests.conftest import make_case


async def _seed_templates(conn, tenant_id):
    # GENERIC denied/portal template (lob NULL) — commercial falls back to this.
    await conn.execute(
        "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
        "VALUES ($1, 'denied', 'portal', NULL, 'Denied', "
        "'Denied. Appeal within {{ appeal_deadline_days }} days.')",
        tenant_id,
    )
    # MA-specific denied/portal template (distinct body).
    await conn.execute(
        "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
        "VALUES ($1, 'denied', 'portal', 'ma', 'MA Denied', "
        "'MA denial. {{ appeal_deadline_days }} day appeal window.')",
        tenant_id,
    )
    # Per-LOB notice params.
    await conn.execute(
        "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
        "($1, 'ma', 'notifications', '{\"appeal_deadline_days\": 65}'::jsonb), "
        "($1, 'commercial', 'notifications', '{\"appeal_deadline_days\": 180}'::jsonb)",
        tenant_id,
    )


async def _body_for_case(conn, tenant_id, case_id):
    env = await conn.fetchval(
        "SELECT envelope FROM shared.outbox "
        "WHERE tenant_id=$1 AND envelope->>'schema_ref'=$2 "
        "AND envelope->'payload'->>'case_id'=$3",
        tenant_id, SchemaRef.NOTIFICATION_SENT, str(case_id),
    )
    if isinstance(env, str):
        env = json.loads(env)
    return env["payload"]["body"]


async def _run_denial(pg_pool, tenant_id, lob):
    """Seed a workflow_instances row for `lob`, fire a denied DECISION_RECORDED,
    and return (rendered_body, notification_log.lob)."""
    from enstellar_workflow.cases.service import CaseService
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    case = make_case(tenant_id=tenant_id, lob=lob)
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

    async with pg_pool.acquire() as conn:
        body = await _body_for_case(conn, tenant_id, case_id)
        log_lob = await conn.fetchval(
            "SELECT lob FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
    return body, log_lob


@pytest.mark.asyncio
async def test_ma_denial_uses_ma_template(pg_pool):
    tenant_id = f"lob-e2e-ma-{uuid.uuid4()}"
    async with pg_pool.acquire() as conn:
        await _seed_templates(conn, tenant_id)

    body, log_lob = await _run_denial(pg_pool, tenant_id, "ma")

    assert "MA denial" in body, body
    assert "65" in body, body
    assert log_lob == "ma"


@pytest.mark.asyncio
async def test_commercial_denial_falls_back_to_generic(pg_pool):
    tenant_id = f"lob-e2e-commercial-{uuid.uuid4()}"
    async with pg_pool.acquire() as conn:
        await _seed_templates(conn, tenant_id)

    body, log_lob = await _run_denial(pg_pool, tenant_id, "commercial")

    assert "Denied. Appeal within 180 days" in body, body
    assert log_lob == "commercial"


@pytest.mark.asyncio
async def test_ma_and_commercial_notices_differ(pg_pool):
    """Same outcome (denied), two LOBs → two materially different notices."""
    ma_tenant = f"lob-e2e-diff-ma-{uuid.uuid4()}"
    commercial_tenant = f"lob-e2e-diff-commercial-{uuid.uuid4()}"
    async with pg_pool.acquire() as conn:
        await _seed_templates(conn, ma_tenant)
        await _seed_templates(conn, commercial_tenant)

    ma_body, ma_log = await _run_denial(pg_pool, ma_tenant, "ma")
    commercial_body, commercial_log = await _run_denial(
        pg_pool, commercial_tenant, "commercial"
    )

    assert ma_log == "ma"
    assert commercial_log == "commercial"
    assert "65" in ma_body
    assert "180" in commercial_body
    assert ma_body != commercial_body
