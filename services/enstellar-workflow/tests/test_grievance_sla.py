import pytest

from enstellar_workflow.workflow_config import ConfigService
from simintero_tenant_context import tenant_transaction

TENANT = "grievance-sla-test-tenant"


async def _seed(pool):
    async with tenant_transaction(pool, TENANT) as conn:
        await conn.execute(
            "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
            "($1,'ma','grievance',"
            "'{\"standard\":{\"acknowledgement_days\":2,\"resolution_days\":30},"
            "\"expedited\":{\"acknowledgement_days\":1,\"resolution_days\":7}}'::jsonb) "
            "ON CONFLICT DO NOTHING",
            TENANT,
        )


@pytest.mark.asyncio
async def test_resolve_grievance_sla_standard(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        sla = await svc.resolve_grievance_sla(
            conn, tenant_id=TENANT, lob="ma", urgency="standard"
        )
    assert sla == {"acknowledgement_days": 2, "resolution_days": 30}


@pytest.mark.asyncio
async def test_resolve_grievance_sla_expedited(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        sla = await svc.resolve_grievance_sla(
            conn, tenant_id=TENANT, lob="ma", urgency="expedited"
        )
    assert sla == {"acknowledgement_days": 1, "resolution_days": 7}


@pytest.mark.asyncio
async def test_resolve_grievance_sla_unseeded_lob_falls_back_to_default(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        # 'medicaid' not seeded -> standard defaults
        sla = await svc.resolve_grievance_sla(
            conn, tenant_id=TENANT, lob="medicaid", urgency="standard"
        )
    assert sla == {"acknowledgement_days": 2, "resolution_days": 30}


@pytest.mark.asyncio
async def test_resolve_grievance_sla_none_lob_returns_default(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        sla = await svc.resolve_grievance_sla(
            conn, tenant_id=TENANT, lob=None, urgency="expedited"
        )
    assert sla == {"acknowledgement_days": 1, "resolution_days": 7}


@pytest.mark.asyncio
async def test_resolve_grievance_sla_unknown_urgency_falls_to_standard(pg_pool):
    await _seed(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, TENANT) as conn:
        sla = await svc.resolve_grievance_sla(
            conn, tenant_id=TENANT, lob="ma", urgency="bogus"
        )
    assert sla == {"acknowledgement_days": 2, "resolution_days": 30}
