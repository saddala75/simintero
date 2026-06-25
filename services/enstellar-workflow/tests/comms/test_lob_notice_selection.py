import json
import uuid

import pytest

from simintero_outbox import SchemaRef


async def _seed(conn, tenant_id):
    # GENERIC denied/portal template (lob NULL)
    await conn.execute(
        "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
        "VALUES ($1, 'denied', 'portal', NULL, 'Denied', "
        "'Denied. Appeal within {{ appeal_deadline_days }} days.')",
        tenant_id,
    )
    # MA-specific denied/portal template
    await conn.execute(
        "INSERT INTO notification_templates (tenant_id, event_type, channel, lob, subject_template, body_template) "
        "VALUES ($1, 'denied', 'portal', 'ma', 'MA Denied', "
        "'MA denial. {{ appeal_deadline_days }} day appeal window.')",
        tenant_id,
    )
    # Per-LOB notice params
    await conn.execute(
        "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
        "($1, 'ma', 'notifications', '{\"appeal_deadline_days\": 65}'::jsonb), "
        "($1, 'commercial', 'notifications', '{\"appeal_deadline_days\": 180}'::jsonb)",
        tenant_id,
    )


async def _body_for_case(conn, case_id):
    env = await conn.fetchval(
        "SELECT envelope FROM shared.outbox "
        "WHERE envelope->>'schema_ref'=$1 "
        "AND envelope->'payload'->>'case_id'=$2",
        SchemaRef.NOTIFICATION_SENT, str(case_id),
    )
    if isinstance(env, str):
        env = json.loads(env)
    return env["payload"]["body"]


@pytest.mark.asyncio
async def test_lob_specific_template_preferred(pg_pool):
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    service = NotificationService(OutboxPublisher())
    tenant_id = f"lob-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await _seed(conn, tenant_id)
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                {"case_id": case_id, "outcome": "denied"},
                "system", "system", lob="ma",
            )
        assert len(ids) == 1
        body = await _body_for_case(conn, case_id)
        log_lob = await conn.fetchval(
            "SELECT lob FROM notification_log WHERE notification_id=$1",
            uuid.UUID(ids[0]),
        )

    assert "MA denial" in body
    assert "65" in body
    assert log_lob == "ma"


@pytest.mark.asyncio
async def test_generic_fallback_with_lob_param(pg_pool):
    """No commercial-specific template → generic renders with the commercial config (180)."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    service = NotificationService(OutboxPublisher())
    tenant_id = f"lob-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await _seed(conn, tenant_id)
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                {"case_id": case_id, "outcome": "denied"},
                "system", "system", lob="commercial",
            )
        assert len(ids) == 1
        body = await _body_for_case(conn, case_id)
        log_lob = await conn.fetchval(
            "SELECT lob FROM notification_log WHERE notification_id=$1",
            uuid.UUID(ids[0]),
        )

    assert "Denied. Appeal within 180 days" in body
    assert log_lob == "commercial"


@pytest.mark.asyncio
async def test_lob_none_uses_generic_default(pg_pool):
    """lob=None → generic template + the DEFAULT 60 (no config for None)."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    service = NotificationService(OutboxPublisher())
    tenant_id = f"lob-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await _seed(conn, tenant_id)
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                {"case_id": case_id, "outcome": "denied"},
                "system", "system",
            )
        assert len(ids) == 1
        body = await _body_for_case(conn, case_id)
        log_lob = await conn.fetchval(
            "SELECT lob FROM notification_log WHERE notification_id=$1",
            uuid.UUID(ids[0]),
        )

    assert "Denied. Appeal within 60 days" in body
    assert log_lob is None
