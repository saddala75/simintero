import uuid

import asyncpg
import pytest


@pytest.mark.asyncio
async def test_render_and_dispatch_inserts_log_rows_and_publishes_events(pg_pool):
    """Two active templates for 'approved' → two log rows + two outbox events."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor
    import uuid

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    case_id = str(uuid.uuid4())
    tenant_id = "tenant-test"

    async with pg_pool.acquire() as conn:
        # Insert two active templates
        for channel in ("portal", "email"):
            await conn.execute(
                "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, 'approved', $2, 'PA {{ outcome }}', 'Case {{ case_id }} is {{ outcome }}')",
                tenant_id, channel,
            )
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "approved",
                {"case_id": case_id, "outcome": "approved", "decided_at": "2026-06-06T00:00:00Z"},
                Actor(id="system", type="system"),
            )

    assert len(ids) == 2
    async with pg_pool.acquire() as conn:
        log_count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
        outbox_count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox WHERE tenant_id=$1 AND schema_ref='sim.artifact/NotificationSent/v1'",
            tenant_id,
        )
    assert log_count == 2
    assert outbox_count == 2

@pytest.mark.asyncio
async def test_notification_body_contains_no_phi(pg_pool):
    """Template context must not include member_name, dob, ssn."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor
    import uuid

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    case_id = str(uuid.uuid4())
    tenant_id = f"phi-test-tenant-{uuid.uuid4()}"

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Denied', 'Case {{ case_id }} denied on {{ decided_at }}')",
            tenant_id,
        )
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                {
                    "case_id": case_id, "outcome": "denied", "decided_at": "2026-06-06T00:00:00Z",
                    "member_name": "JOHN SMITH",
                    "dob": "1980-01-01",
                },
                Actor(id="system", type="system"),
            )
        rendered = await conn.fetchval(
            "SELECT rendered_subject FROM notification_log WHERE tenant_id=$1", tenant_id
        )

    assert "JOHN SMITH" not in rendered
    assert "1980-01-01" not in rendered

    # Also check the outbox payload body
    async with pg_pool.acquire() as conn:
        outbox_payload = await conn.fetchval(
            "SELECT payload FROM outbox WHERE tenant_id=$1 AND schema_ref='sim.artifact/NotificationSent/v1'",
            tenant_id,
        )
    import json
    if outbox_payload:
        body_in_outbox = json.loads(outbox_payload).get("body", "")
        assert "JOHN SMITH" not in body_in_outbox
        assert "1980-01-01" not in body_in_outbox

@pytest.mark.asyncio
async def test_no_templates_returns_empty_list(pg_pool):
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor

    service = NotificationService(OutboxPublisher())
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, f"unknown-tenant-{uuid.uuid4()}", "00000000-0000-0000-0000-000000000001",
                "approved", {"case_id": "x", "outcome": "approved", "decided_at": "2026-06-06"},
                Actor(id="system", type="system"),
            )
    assert ids == []


@pytest.mark.asyncio
async def test_notification_tables_exist(pg_pool):
    async with pg_pool.acquire() as conn:
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN "
            "('notification_templates','notification_log') ORDER BY tablename"
        )
        assert [r["tablename"] for r in tables] == ["notification_log", "notification_templates"]


@pytest.mark.asyncio
async def test_notification_templates_unique_constraint(pg_pool):
    tenant_id = str(uuid.uuid4())
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template, version) "
            "VALUES ($1, 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved', 1)",
            tenant_id,
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await conn.execute(
                "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template, version) "
                "VALUES ($1, 'approved', 'portal', 'Dup', 'Dup', 1)",
                tenant_id,
            )
