import pytest

from enstellar_workflow.workflow_config import ConfigService
from simintero_tenant_context import tenant_transaction

TENANT = "cfg-test-tenant"


async def _seed(pool):
    async with tenant_transaction(pool, TENANT) as conn:
        await conn.execute(
            "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
            "($1,'commercial','clocks','{\"decision\":{\"standard\":5}}'::jsonb), "
            "($1,'ma','clocks','{\"decision\":{\"standard\":7}}'::jsonb) "
            "ON CONFLICT DO NOTHING",
            TENANT,
        )


@pytest.mark.asyncio
async def test_resolve_clock_is_lob_aware(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        comm = await svc.resolve_clock(
            conn, tenant_id=TENANT, lob="commercial", urgency="standard"
        )
        ma = await svc.resolve_clock(
            conn, tenant_id=TENANT, lob="ma", urgency="standard"
        )
    assert comm.duration_calendar_days == 5
    # SAME tenant, SAME urgency, different LOB -> different duration
    assert ma.duration_calendar_days == 7


@pytest.mark.asyncio
async def test_resolve_clock_falls_back_to_defaults_for_unseeded_lob(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        # 'medicaid' not seeded -> fall back to CLOCK_RULES standard/decision = 7
        d = await svc.resolve_clock(
            conn, tenant_id=TENANT, lob="medicaid", urgency="standard"
        )
    assert d.duration_calendar_days == 7


@pytest.mark.asyncio
async def test_resolve_clock_raises_for_unknown_urgency_with_no_fallback(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        with pytest.raises(ValueError):
            await svc.resolve_clock(
                conn, tenant_id=TENANT, lob="commercial", urgency="bogus"
            )
