import json
import pytest
import asyncpg
from testcontainers.postgres import PostgresContainer
from canonical_model import EventEnvelope
from simintero_outbox.writer import append_event

@pytest.fixture(scope="module")
def pg():
    with PostgresContainer("postgres:16-alpine") as c:
        yield c.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")

async def _setup(pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE SCHEMA IF NOT EXISTS shared;
            CREATE TABLE IF NOT EXISTS shared.outbox (
              event_id text primary key,
              topic text not null,
              key text,
              envelope jsonb not null,
              tenant_id text not null,
              published_at timestamptz
            );
        """)

def _envelope() -> EventEnvelope:
    return EventEnvelope.model_validate({
        "event_id": "evt_01HZ0Q9KT0R8X4M2WB7C5N3D6F",
        "schema_ref": "sim.case.state-changed/CaseStateChanged/v1",
        "occurred_at": "2026-06-14T12:00:00Z",
        "tenant": {"tenant_id": "t_acme", "lob": "MA"},
        "correlation_id": "case_123",
        "causation_id": None,
        "actor": {"type": "service", "id": "workflow-engine"},
        "trace_ref": None,
        "payload": {"from_status": "intake", "to_status": "completeness_check"},
    })

@pytest.mark.asyncio
async def test_append_writes_one_jsonb_row_routed_by_schema_ref(pg):
    pool = await asyncpg.create_pool(pg, min_size=1, max_size=2)
    try:
        await _setup(pool)
        env = _envelope()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await append_event(conn, env)
        row = await pool.fetchrow("SELECT topic, key, tenant_id, envelope FROM shared.outbox WHERE event_id=$1", env.event_id)
        assert row["topic"] == "sim.case.lifecycle"
        assert row["key"] == "case_123"
        assert row["tenant_id"] == "t_acme"
        assert json.loads(row["envelope"])["schema_ref"] == env.schema_ref
    finally:
        await pool.close()

@pytest.mark.asyncio
async def test_append_is_idempotent_on_event_id(pg):
    pool = await asyncpg.create_pool(pg, min_size=1, max_size=2)
    try:
        await _setup(pool)
        env = _envelope()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await append_event(conn, env)
                await append_event(conn, env)
        count = await pool.fetchval("SELECT count(*) FROM shared.outbox WHERE event_id=$1", env.event_id)
        assert count == 1
    finally:
        await pool.close()
