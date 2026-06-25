"""Directory roster HTTP route (B2).

GET /directory returns the tenant's seeded, assignable reviewers/investigators
so a coordinator picks a real person (name + Keycloak sub) instead of pasting a
raw sub. The directory table has FORCE ROW LEVEL SECURITY, so a foreign-tenant
row is invisible. Migration 0025 seeds four reviewers for tenant-dev with FIXED
subs matching the demo-realm reviewer ids.
"""
from __future__ import annotations

from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from enstellar_workflow.db.connection import close_pool
from enstellar_workflow.main import app
from simintero_tenant_context import tenant_transaction

SEEDED_SUBS = {
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    "44444444-4444-4444-4444-444444444444",
}
SEEDED_NAMES = {"E2E Reviewer", "Medical Director", "Janet Jones", "Sam Smith"}


@pytest_asyncio.fixture
async def ac(db_dsn: str, monkeypatch) -> AsyncClient:
    """AsyncClient targeting the FastAPI app, wired to the Testcontainers Postgres."""
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
    ) as client:
        yield client

    await close_pool()
    conn_mod._pool = None


@pytest.mark.asyncio
async def test_lists_seeded_tenant_dev_roster(ac: AsyncClient):
    resp = await ac.get("/directory", headers={"Authorization": "Bearer tenant-dev"})
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert {r["sub"] for r in rows} >= SEEDED_SUBS
    assert {r["display_name"] for r in rows} >= SEEDED_NAMES
    for r in rows:
        assert r["role"] == "reviewer"


@pytest.mark.asyncio
async def test_role_filter(ac: AsyncClient):
    resp = await ac.get(
        "/directory?role=reviewer", headers={"Authorization": "Bearer tenant-dev"}
    )
    assert resp.status_code == 200, resp.text
    assert {r["sub"] for r in resp.json()} >= SEEDED_SUBS

    resp = await ac.get(
        "/directory?role=investigator", headers={"Authorization": "Bearer tenant-dev"}
    )
    assert resp.status_code == 200, resp.text
    # No seeded investigators (all four are reviewers).
    assert resp.json() == []


# ---------------------------------------------------------------------------
# RLS isolation: the testcontainers default role is a SUPERUSER (bypasses RLS,
# and FORCE only forces the table OWNER — never superusers), so the app-level
# WHERE tenant_id filter, not the policy, is what excludes a foreign row under
# the default role. To genuinely prove the FORCE RLS POLICY we must connect as
# a NON-SUPERUSER app role and run a RAW SELECT with no WHERE tenant_id — only
# the policy can then exclude tenant B's row. Mirrors
# tests/appeals/test_appeals_repository.py::test_rls_isolates_appeals_across_tenants.
# ---------------------------------------------------------------------------
APP_USER = "directory_rls_app_user"
APP_PASSWORD = "directory_rls_app_pw"


def _app_dsn(admin_dsn: str) -> str:
    after_scheme = admin_dsn.split("://", 1)[1]
    host_part = after_scheme.split("@", 1)[1]
    return f"postgresql://{APP_USER}:{APP_PASSWORD}@{host_part}"


@pytest.mark.asyncio
async def test_rls_policy_isolates_directory_across_tenants(db_dsn: str):
    """A non-superuser raw SELECT under tenant A's GUC must NOT see tenant B's row.

    Seed one directory row for each of two tenants AS THE SUPERUSER, then connect
    as a NON-SUPERUSER app role with sim.tenant_id = tenant A and run a RAW
    `SELECT * FROM directory` (no WHERE tenant_id). Only the FORCE RLS policy can
    exclude tenant B's row, so this genuinely exercises the policy, not the
    app-level filter.
    """
    tenant_a = f"dir-{uuid4()}"
    tenant_b = f"dir-{uuid4()}"
    sub_a = "rls-sub-a"
    sub_b = "rls-sub-b"

    admin = await asyncpg.connect(db_dsn)
    try:
        # Seed both rows as the superuser (bypasses RLS), one per tenant.
        await admin.execute("SELECT set_config('sim.tenant_id', $1, true)", tenant_a)
        await admin.execute(
            "INSERT INTO directory (tenant_id, sub, display_name, role) "
            "VALUES ($1, $2, 'Tenant A Reviewer', 'reviewer')",
            tenant_a, sub_a,
        )
        await admin.execute("SELECT set_config('sim.tenant_id', $1, true)", tenant_b)
        await admin.execute(
            "INSERT INTO directory (tenant_id, sub, display_name, role) "
            "VALUES ($1, $2, 'Tenant B Reviewer', 'reviewer')",
            tenant_b, sub_b,
        )
        # (Re)create a NON-SUPERUSER login role and grant it read on directory.
        await admin.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_USER}') THEN
                    REVOKE ALL ON directory FROM {APP_USER};
                    DROP ROLE {APP_USER};
                END IF;
            END
            $$;
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT ON directory TO {APP_USER};
            """
        )
    finally:
        await admin.close()

    pool = await asyncpg.create_pool(_app_dsn(db_dsn), min_size=1, max_size=2)
    try:
        # Under tenant A's GUC: RAW SELECT (no WHERE tenant_id) — ONLY the policy
        # can filter. Tenant B's row must be invisible; tenant A's must be visible.
        async with tenant_transaction(pool, tenant_a) as conn:
            rows = await conn.fetch("SELECT * FROM directory")
        subs = {r["sub"] for r in rows}
        assert sub_a in subs, "tenant A's own row must be visible under its GUC"
        assert sub_b not in subs, "RLS policy must hide tenant B's row"
        # Sanity: every visible row belongs to tenant A (policy, not app filter).
        assert all(r["tenant_id"] == tenant_a for r in rows)

        # Under tenant B's GUC: the mirror — only tenant B's row is visible.
        async with tenant_transaction(pool, tenant_b) as conn:
            rows_b = await conn.fetch("SELECT * FROM directory")
        subs_b = {r["sub"] for r in rows_b}
        assert sub_b in subs_b
        assert sub_a not in subs_b
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_investigator_role_filter_includes_only_investigators(
    ac: AsyncClient, pg_pool: asyncpg.Pool
):
    # Use a FRESH tenant so this test's extra row never pollutes the seeded
    # tenant-dev roster (keeps role-filter assertions order-independent).
    tenant = f"dir-{uuid4()}"
    inv_sub = "inv-sub-1"
    async with pg_pool.acquire() as conn:
        await conn.execute("SELECT set_config('sim.tenant_id', $1, true)", tenant)
        await conn.execute(
            "INSERT INTO directory (tenant_id, sub, display_name, role) "
            "VALUES ($1, $2, 'Investigator One', 'investigator')",
            tenant, inv_sub,
        )

    headers = {"Authorization": f"Bearer {tenant}"}
    resp = await ac.get("/directory?role=reviewer", headers=headers)
    assert resp.status_code == 200, resp.text
    assert inv_sub not in {r["sub"] for r in resp.json()}

    resp = await ac.get("/directory?role=investigator", headers=headers)
    assert resp.status_code == 200, resp.text
    subs = {r["sub"] for r in resp.json()}
    assert subs == {inv_sub}
