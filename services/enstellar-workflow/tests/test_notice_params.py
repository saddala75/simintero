import pytest

from enstellar_workflow.workflow_config import ConfigService
from simintero_tenant_context import tenant_transaction

TENANT = "notice-params-test-tenant"


async def _seed(pool):
    async with tenant_transaction(pool, TENANT) as conn:
        await conn.execute(
            "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
            "($1,'ma','notifications','{\"appeal_deadline_days\": 65}'::jsonb), "
            "($1,'commercial','notifications',"
            "'{\"appeal_deadline_days\": 180, \"reminder_days\": 7}'::jsonb) "
            "ON CONFLICT DO NOTHING",
            TENANT,
        )


@pytest.mark.asyncio
async def test_resolve_notice_params_is_lob_aware(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        params = await svc.resolve_notice_params(conn, tenant_id=TENANT, lob="ma")
    assert params == {"appeal_deadline_days": 65}


@pytest.mark.asyncio
async def test_resolve_notice_params_unseeded_lob_falls_back_to_default(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        # 'medicaid' not seeded -> default appeal_deadline_days = 60
        params = await svc.resolve_notice_params(
            conn, tenant_id=TENANT, lob="medicaid"
        )
    assert params == {"appeal_deadline_days": 60}


@pytest.mark.asyncio
async def test_resolve_notice_params_none_lob_returns_default(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        params = await svc.resolve_notice_params(conn, tenant_id=TENANT, lob=None)
    assert params == {"appeal_deadline_days": 60}


@pytest.mark.asyncio
async def test_resolve_notice_params_extra_keys_merge_over_default(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        params = await svc.resolve_notice_params(
            conn, tenant_id=TENANT, lob="commercial"
        )
    # default keys present + seeded override + extra seeded key
    assert params == {"appeal_deadline_days": 180, "reminder_days": 7}
