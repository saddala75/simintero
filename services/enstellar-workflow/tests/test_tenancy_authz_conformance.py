"""Section C2b conformance verification — proves the platform tenancy RLS GUC
pattern works against the workflow-engine's own database, using the shared
conformance kit (`simintero_conformance.assert_rls_isolates`).

Both services now share the platform `simintero-authz` + `simintero-tenant-context`
substrate (Tasks 3-4). This test closes the loop on the tenancy half: it runs the
kit's RLS probe against a REAL workflow-engine RLS table (`workflow_instances`,
isolated by migration 0010 with the `current_setting('sim.tenant_id', true)`
policy) and confirms the transaction-local GUC isolates one tenant's rows from
another.

Why a non-superuser role: the testcontainers default Postgres role is a SUPERUSER,
and superusers bypass RLS unconditionally (even under FORCE ROW LEVEL SECURITY).
So the probe must connect as a non-superuser app role to exercise the policy. We
provision that role + grants with the admin (superuser) connection, seed both
tenants' rows as admin (insert bypasses RLS for the superuser), then point the
probe pool at the app role. This mirrors the kit's own self-check and the
tenant-context Task 4 test.
"""
import uuid

import asyncpg
import pytest

from simintero_conformance import assert_rls_isolates

APP_USER = "wf_rls_app_user"
APP_PASSWORD = "wf_rls_app_pw"

TENANT_A = "t_a"
TENANT_B = "t_b"


def _app_dsn(admin_dsn: str) -> str:
    """Rewrite the admin DSN credentials to the non-superuser app role."""
    after_scheme = admin_dsn.split("://", 1)[1]
    host_part = after_scheme.split("@", 1)[1]
    return f"postgresql://{APP_USER}:{APP_PASSWORD}@{host_part}"


async def _provision_and_seed(admin_dsn: str) -> None:
    """Create a non-superuser app role with grants on workflow_instances, then
    seed one row for each of two tenants (as admin; superuser bypasses RLS)."""
    conn = await asyncpg.connect(admin_dsn)
    try:
        # Idempotent role provisioning: revoke any grants from a prior run (a role
        # holding privileges cannot be DROPped) before recreating it. Re-runnable
        # across the two tests in this module, which share the session DB.
        await conn.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_USER}') THEN
                    REVOKE ALL ON workflow_instances FROM {APP_USER};
                    DROP ROLE {APP_USER};
                END IF;
            END
            $$;
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_instances TO {APP_USER};
            """
        )
        # Clean any prior probe rows so the count is deterministic across re-runs.
        await conn.execute(
            "DELETE FROM workflow_instances WHERE tenant_id = ANY($1::text[])",
            [TENANT_A, TENANT_B],
        )
        for tenant in (TENANT_A, TENANT_B):
            await conn.execute(
                """
                INSERT INTO workflow_instances
                    (case_id, tenant_id, correlation_id, lob, status, case_json)
                VALUES ($1, $2, $3, 'MA', 'intake', '{}'::jsonb)
                """,
                uuid.uuid4(),
                tenant,
                f"corr-{tenant}-{uuid.uuid4()}",
            )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_rls_isolates_workflow_instances(db_dsn: str) -> None:
    """The platform GUC isolates tenants on the real workflow_instances table.

    With the tx-local `sim.tenant_id` set to tenant B, a non-superuser SELECT must
    NOT see tenant A's row. assert_rls_isolates raises on any leak; it must NOT
    raise here.
    """
    await _provision_and_seed(db_dsn)
    pool = await asyncpg.create_pool(_app_dsn(db_dsn), min_size=1, max_size=4)
    try:
        await assert_rls_isolates(pool, "workflow_instances", TENANT_A, TENANT_B)
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_superuser_would_falsely_leak(db_dsn: str) -> None:
    """Load-bearing proof that the non-superuser switch matters: probed via the
    SUPERUSER admin pool, the SAME RLS table leaks (superusers bypass RLS), so
    assert_rls_isolates raises. This is exactly the false negative the app-role
    pool avoids in test_rls_isolates_workflow_instances above — confirming the
    test exercises a real policy, not an empty table."""
    await _provision_and_seed(db_dsn)
    pool = await asyncpg.create_pool(db_dsn, min_size=1, max_size=2)
    try:
        with pytest.raises(AssertionError, match="RLS LEAK"):
            await assert_rls_isolates(pool, "workflow_instances", TENANT_A, TENANT_B)
    finally:
        await pool.close()
