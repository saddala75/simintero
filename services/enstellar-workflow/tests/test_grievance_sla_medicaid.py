"""Verify migration 0034 seeds medicaid grievance SLA config."""
import json
import pytest
import asyncpg


@pytest.mark.asyncio
async def test_tenant_dev_has_medicaid_grievance_sla(db_dsn):
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        row = await conn.fetchrow(
            "SELECT config FROM workflow_config "
            "WHERE tenant_id='tenant-dev' AND lob='medicaid' AND domain='grievance'"
        )
        assert row is not None, "medicaid grievance SLA row missing for tenant-dev"
        cfg = json.loads(row["config"])
        assert cfg["standard"]["resolution_days"] == 90
        assert cfg["expedited"]["resolution_days"] == 3
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_tenant_dev_has_all_three_lobs(db_dsn):
    conn = await asyncpg.connect(db_dsn)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'tenant-dev'")
        rows = await conn.fetch(
            "SELECT lob FROM workflow_config "
            "WHERE tenant_id='tenant-dev' AND domain='grievance' ORDER BY lob"
        )
        lobs = {r["lob"] for r in rows}
        assert lobs == {"commercial", "ma", "medicaid"}, f"Missing LOBs: {lobs}"
    finally:
        await conn.close()
