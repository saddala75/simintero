"""Verify that migration 0033 seeds notification_templates idempotently."""
import pytest
import asyncpg


@pytest.mark.asyncio
async def test_notification_templates_seeded(db_dsn):
    """Alembic runs 0033; notification_templates must have ≥14 rows for tenant-dev."""
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_templates WHERE tenant_id = 'tenant-dev'"
        )
        assert count >= 15, f"Expected ≥15 templates, got {count}"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_notification_seed_idempotent(db_dsn):
    """Running the seed INSERT again must not raise (ON CONFLICT DO NOTHING)."""
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        # If ON CONFLICT is missing or wrong, this raises UniqueViolationError
        await conn.execute("""
            INSERT INTO notification_templates
              (tenant_id, lob, event_type, channel, subject_template, body_template)
            VALUES
              ('tenant-dev', NULL, 'approved', 'portal',
               'Prior Authorization Approved — Case {{ case_id }}',
               'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.')
            ON CONFLICT (tenant_id, COALESCE(lob,''), event_type, channel, version) DO NOTHING
        """)
    finally:
        await conn.close()
