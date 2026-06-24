"""Cross-tenant RLS isolation test for workflow_config (migration 0014).

Mirrors test_tenancy_authz_conformance.py exactly but targets workflow_config.
RLS is only exercised via a NON-superuser app role — the testcontainers default
Postgres role is a SUPERUSER and superusers bypass RLS unconditionally (even
with FORCE ROW LEVEL SECURITY), so the probe must connect as a non-privileged
app role to exercise the tenant_isolation policy.

Pattern:
  1. Provision a non-superuser role with SELECT on workflow_config.
  2. Seed one row per tenant as admin/superuser (INSERT bypasses RLS for SU).
  3. Open a pool as the app role and call assert_rls_isolates — it sets
     sim.tenant_id = TENANT_B in a transaction and asserts TENANT_A's row
     is invisible.  Raises AssertionError("RLS LEAK …") if any row leaks.
"""
import uuid

import asyncpg
import pytest

from simintero_conformance import assert_rls_isolates

APP_USER = "wf_cfg_rls_app_user"
APP_PASSWORD = "wf_cfg_rls_app_pw"

TENANT_A = "cfg_rls_ta"
TENANT_B = "cfg_rls_tb"


def _app_dsn(admin_dsn: str) -> str:
    """Rewrite the admin DSN credentials to the non-superuser app role."""
    after_scheme = admin_dsn.split("://", 1)[1]
    host_part = after_scheme.split("@", 1)[1]
    return f"postgresql://{APP_USER}:{APP_PASSWORD}@{host_part}"


async def _provision_and_seed(admin_dsn: str) -> None:
    """Create a non-superuser app role with SELECT on workflow_config, then
    seed one probe row for each tenant (as admin; superuser bypasses RLS)."""
    conn = await asyncpg.connect(admin_dsn)
    try:
        # Idempotent: revoke + drop before recreating so the test is re-runnable.
        await conn.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_USER}') THEN
                    REVOKE ALL ON workflow_config FROM {APP_USER};
                    DROP ROLE {APP_USER};
                END IF;
            END
            $$;
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT ON workflow_config TO {APP_USER};
            """
        )
        # Remove any leftover probe rows so counts are deterministic.
        await conn.execute(
            "DELETE FROM workflow_config WHERE tenant_id = ANY($1::text[])",
            [TENANT_A, TENANT_B],
        )
        for tenant in (TENANT_A, TENANT_B):
            await conn.execute(
                """
                INSERT INTO workflow_config (tenant_id, lob, domain, config)
                VALUES ($1, 'probe', 'clocks', '{"decision":{"standard":5}}'::jsonb)
                ON CONFLICT (tenant_id, lob, domain) DO NOTHING
                """,
                tenant,
            )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_rls_isolates_workflow_config(db_dsn: str) -> None:
    """The tenant_isolation RLS policy on workflow_config genuinely blocks
    cross-tenant reads when the connection is a non-superuser app role.

    With sim.tenant_id set to TENANT_B, a SELECT must NOT return TENANT_A's
    row.  assert_rls_isolates raises AssertionError("RLS LEAK …") on any leak.
    """
    await _provision_and_seed(db_dsn)
    pool = await asyncpg.create_pool(_app_dsn(db_dsn), min_size=1, max_size=4)
    try:
        await assert_rls_isolates(pool, "workflow_config", TENANT_A, TENANT_B)
    finally:
        await pool.close()
