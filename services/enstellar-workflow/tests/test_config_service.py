import pytest

from enstellar_workflow.workflow_config import ConfigService, SlaConfig
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


@pytest.mark.asyncio
async def test_resolve_clock_falls_back_when_config_section_is_scalar(pg_pool):
    """A workflow_config row whose clock section is a scalar (not a dict) must
    not raise AttributeError; _lookup_days returns None and resolve_clock falls
    back to CLOCK_RULES (standard/decision = 7 days)."""
    MALFORMED_TENANT = "cfg-malformed-tenant"
    async with tenant_transaction(pg_pool, MALFORMED_TENANT) as conn:
        await conn.execute(
            "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
            "($1, 'commercial', 'clocks', '{\"decision\": 5}'::jsonb) "
            "ON CONFLICT DO NOTHING",
            MALFORMED_TENANT,
        )
        svc = ConfigService()
        d = await svc.resolve_clock(
            conn,
            tenant_id=MALFORMED_TENANT,
            lob="commercial",
            urgency="standard",
            clock_type="decision",
        )
    # config["decision"] = 5 (scalar, not a dict) → _lookup_days returns None
    # → falls back to CLOCK_RULES[("standard", "decision")] = 7
    assert d.duration_calendar_days == 7


SLA_TENANT = "sla-cfg-test-tenant"


async def _seed_sla(pool):
    async with tenant_transaction(pool, SLA_TENANT) as conn:
        await conn.execute(
            "INSERT INTO workflow_config (tenant_id, lob, domain, config) VALUES "
            "($1,'commercial','sla',"
            "'{\"warning_threshold_pct\": 75, \"escalation_queue\": \"md_review\"}'::jsonb), "
            "($1,'ma','sla',"
            "'{\"warning_threshold_pct\": 80, \"escalation_queue\": \"md_review\"}'::jsonb) "
            "ON CONFLICT DO NOTHING",
            SLA_TENANT,
        )


@pytest.mark.asyncio
async def test_resolve_sla_is_lob_aware(pg_pool):
    await _seed_sla(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, SLA_TENANT) as conn:
        comm = await svc.resolve_sla(conn, tenant_id=SLA_TENANT, lob="commercial")
        ma = await svc.resolve_sla(conn, tenant_id=SLA_TENANT, lob="ma")
    assert comm == SlaConfig(warning_threshold_pct=75, escalation_queue="md_review")
    # SAME tenant, different LOB -> different threshold
    assert ma == SlaConfig(warning_threshold_pct=80, escalation_queue="md_review")


@pytest.mark.asyncio
async def test_resolve_sla_falls_back_to_defaults_for_unseeded_lob(pg_pool):
    await _seed_sla(pg_pool)
    svc = ConfigService()
    async with tenant_transaction(pg_pool, SLA_TENANT) as conn:
        # 'medicaid' not seeded -> default SlaConfig(75, md_review)
        sla = await svc.resolve_sla(conn, tenant_id=SLA_TENANT, lob="medicaid")
    assert sla == SlaConfig(warning_threshold_pct=75, escalation_queue="md_review")


@pytest.mark.asyncio
async def test_resolve_sla_falls_back_to_defaults_for_unseeded_tenant(pg_pool):
    svc = ConfigService()
    async with tenant_transaction(pg_pool, "sla-unseeded-tenant") as conn:
        sla = await svc.resolve_sla(
            conn, tenant_id="sla-unseeded-tenant", lob="commercial"
        )
    assert sla == SlaConfig(warning_threshold_pct=75, escalation_queue="md_review")
