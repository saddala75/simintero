"""Migration test for 0014_workflow_config — RLS on + seeded LOB clock profiles."""
import json

import pytest
from simintero_tenant_context import tenant_transaction


@pytest.mark.asyncio
async def test_workflow_config_rls_enabled(pg_pool):
    """RLS must be both ENABLED and FORCED on workflow_config."""
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT relrowsecurity, relforcerowsecurity "
            "FROM pg_class WHERE relname = 'workflow_config'"
        )
    assert row is not None, "workflow_config table not found"
    assert row["relrowsecurity"] is True
    assert row["relforcerowsecurity"] is True


@pytest.mark.asyncio
async def test_workflow_config_seed_rows_are_lob_distinct(pg_pool):
    """The two demo-tenant seed rows exist and encode distinct LOB clock profiles."""
    async with tenant_transaction(pg_pool, "demo-tenant") as conn:
        rows = await conn.fetch(
            "SELECT lob, config FROM workflow_config "
            "WHERE tenant_id = 'demo-tenant' AND domain = 'clocks' ORDER BY lob"
        )
    configs = {}
    for row in rows:
        config = row["config"]
        if isinstance(config, str):  # asyncpg returns jsonb as str (no codec set)
            config = json.loads(config)
        configs[row["lob"]] = config

    assert "commercial" in configs, "missing commercial seed row"
    assert "ma" in configs, "missing ma seed row"
    assert configs["commercial"]["decision"]["standard"] == 5
    assert configs["ma"]["decision"]["standard"] == 7
