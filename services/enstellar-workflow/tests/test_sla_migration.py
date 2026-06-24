import json

import pytest

from simintero_tenant_context import tenant_transaction

DEMO_TENANT = "demo-tenant"


@pytest.mark.asyncio
async def test_clocks_has_warned_at_column(pg_pool):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='clocks' AND column_name='warned_at'"
        )
    assert row is not None, "clocks.warned_at column should exist after migration 0015"


@pytest.mark.asyncio
async def test_sla_config_seeded_per_lob(pg_pool):
    async with tenant_transaction(pg_pool, DEMO_TENANT) as conn:
        rows = await conn.fetch(
            "SELECT lob, config FROM workflow_config "
            "WHERE tenant_id=$1 AND domain='sla'",
            DEMO_TENANT,
        )

    by_lob = {}
    for r in rows:
        cfg = r["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        by_lob[r["lob"]] = cfg

    assert "commercial" in by_lob, "commercial sla seed row should exist"
    assert "ma" in by_lob, "ma sla seed row should exist"
    assert by_lob["commercial"]["warning_threshold_pct"] == 75
    assert by_lob["ma"]["warning_threshold_pct"] == 80
    assert by_lob["commercial"]["escalation_queue"] == "md_review"
    assert by_lob["ma"]["escalation_queue"] == "md_review"
