"""Integration tests for GET /queues/{queue_id}/stats."""
import uuid

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app

pytestmark = pytest.mark.asyncio


@pytest.fixture
def tenant_id() -> str:
    """Unique tenant per test to avoid cross-test data contamination."""
    return f"tenant-ug-{uuid.uuid4().hex[:8]}"


@pytest_asyncio.fixture
async def client(db_dsn: str, monkeypatch) -> AsyncClient:
    monkeypatch.setenv(
        "WORKFLOW_DB_URL",
        db_dsn.replace("postgresql://", "postgresql+asyncpg://"),
    )
    import enstellar_workflow.config as cfg_mod
    import enstellar_workflow.db.connection as conn_mod

    cfg_mod._settings = None
    conn_mod._pool = None

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    await close_pool()
    conn_mod._pool = None


@pytest_asyncio.fixture
async def db_conn(db_dsn: str) -> asyncpg.Connection:
    conn = await asyncpg.connect(db_dsn)
    yield conn
    await conn.close()


async def test_queue_stats_zero_for_fresh_environment(client, tenant_id):
    resp = await client.get(
        "/queues/standard/stats",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_determinations"] == 0
    assert body["adverse_human_signed_pct"] == 0.0
    assert body["sla_compliance_expedited_pct"] == 0.0
    assert "period_start" in body
    assert "period_end" in body


async def test_queue_stats_counts_ai_auto_approved(client, db_conn, tenant_id):
    await db_conn.execute(
        """INSERT INTO workflow_instances
           (case_id, tenant_id, status, assignee_queue, case_json, created_at,
            correlation_id, lob, urgency, workflow_def_version, updated_at)
           VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                   '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW(),
                   gen_random_uuid()::text, 'commercial', 'standard', 'v1', NOW())""",
        tenant_id,
    )
    resp = await client.get(
        "/queues/standard/stats",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert resp.json()["ai_determinations"] == 1


async def test_queue_stats_tenant_isolation(client, db_conn, tenant_id):
    """Data inserted for a different tenant must NOT appear in this tenant's stats."""
    other = f"other-tenant-{uuid.uuid4().hex[:8]}"
    await db_conn.execute(
        """INSERT INTO workflow_instances
           (case_id, tenant_id, status, assignee_queue, case_json, created_at,
            correlation_id, lob, urgency, workflow_def_version, updated_at)
           VALUES (gen_random_uuid(), $1, 'approved', 'standard',
                   '{"decisions": [{"auto_approved": true}]}'::jsonb, NOW(),
                   gen_random_uuid()::text, 'commercial', 'standard', 'v1', NOW())""",
        other,
    )
    resp = await client.get(
        "/queues/standard/stats",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    # tenant_id has no rows; other tenant's rows must NOT bleed through
    assert resp.json()["ai_determinations"] == 0


async def test_queue_stats_sla_compliance_expedited(client, db_conn, tenant_id):
    case_id = uuid.uuid4()
    await db_conn.execute(
        """INSERT INTO clocks
           (clock_id, case_id, tenant_id, urgency, clock_type, state,
            duration_calendar_days, started_at, deadline, breached_at)
           VALUES (gen_random_uuid(), $1, $2, 'expedited', 'pa_review', 'running',
                   3, NOW(), NOW() + interval '3 days', NULL)""",
        case_id, tenant_id,
    )
    resp = await client.get(
        "/queues/standard/stats",
        headers={"Authorization": f"Bearer {tenant_id}"},
    )
    assert resp.json()["sla_compliance_expedited_pct"] == 100.0
