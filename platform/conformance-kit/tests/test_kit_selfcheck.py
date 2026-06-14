import pytest
import asyncpg
from testcontainers.postgres import PostgresContainer
from simintero_conformance import assert_rls_isolates, assert_envelope_valid, assert_no_adverse_without_guard

# NOTE: assert_rls_isolates must run on a NON-SUPERUSER pool. The testcontainers
# default Postgres role is a SUPERUSER, and superusers bypass RLS unconditionally
# (even with FORCE ROW LEVEL SECURITY). So the "passes on isolated table" probe
# would FALSELY report a leak if it connected as the superuser. We provision the
# schema + a non-superuser app role with the admin URL, then point the probe pool
# at that app role (mirroring tenant-context's Task 4 test pattern).
APP_USER = "app_user"
APP_PASSWORD = "app_pw"


@pytest.fixture(scope="module")
def pg():
    with PostgresContainer("postgres:16-alpine") as c:
        yield c.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")


def _app_url(admin_url: str) -> str:
    # Rewrite credentials in the admin URL to the non-superuser app role.
    after_scheme = admin_url.split("://", 1)[1]
    host_part = after_scheme.split("@", 1)[1]
    return f"postgresql://{APP_USER}:{APP_PASSWORD}@{host_part}"


async def _admin_setup_isolated(admin_url: str) -> None:
    """Create an RLS-isolated table, a non-superuser app role, seed t_a + t_b rows."""
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f"""
            DROP TABLE IF EXISTS probe_isolated;
            CREATE TABLE probe_isolated (tenant_id text not null, body text);
            ALTER TABLE probe_isolated ENABLE ROW LEVEL SECURITY;
            ALTER TABLE probe_isolated FORCE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS tenant_isolation ON probe_isolated;
            CREATE POLICY tenant_isolation ON probe_isolated
              USING (tenant_id = current_setting('sim.tenant_id', true));
            DROP ROLE IF EXISTS {APP_USER};
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT, INSERT, UPDATE, DELETE ON probe_isolated TO {APP_USER};
            INSERT INTO probe_isolated(tenant_id, body) VALUES ('t_a','secret-a');
            INSERT INTO probe_isolated(tenant_id, body) VALUES ('t_b','secret-b');
        """)
    finally:
        await conn.close()


async def _admin_setup_unisolated(admin_url: str) -> None:
    """Create a table with NO RLS, seed t_a + t_b rows (grant to app role for parity)."""
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f"""
            DROP TABLE IF EXISTS probe_unisolated;
            CREATE TABLE probe_unisolated (tenant_id text not null, body text);
            GRANT SELECT, INSERT, UPDATE, DELETE ON probe_unisolated TO {APP_USER};
            INSERT INTO probe_unisolated(tenant_id, body) VALUES ('t_a','secret-a');
            INSERT INTO probe_unisolated(tenant_id, body) VALUES ('t_b','secret-b');
        """)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_rls_probe_passes_on_isolated_table(pg):
    # Set up table + RLS + app_user as admin; insert t_a and t_b rows; then run the
    # probe on a NON-SUPERUSER app_user pool -> assert_rls_isolates must NOT raise.
    await _admin_setup_isolated(pg)
    pool = await asyncpg.create_pool(_app_url(pg), min_size=1, max_size=4)
    try:
        # No leak under a non-superuser role: tenant_b cannot see tenant_a's row.
        await assert_rls_isolates(pool, "probe_isolated", "t_a", "t_b")
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_superuser_would_falsely_leak_on_isolated_table(pg):
    # Load-bearing proof that the non-superuser switch matters: the SAME RLS-isolated
    # table, probed via the SUPERUSER admin pool, DOES leak (superusers bypass RLS),
    # so assert_rls_isolates raises. This is exactly the false positive the app_user
    # pool avoids in test_rls_probe_passes_on_isolated_table above.
    await _admin_setup_isolated(pg)
    pool = await asyncpg.create_pool(pg, min_size=1, max_size=2)
    try:
        with pytest.raises(AssertionError, match="RLS LEAK"):
            await assert_rls_isolates(pool, "probe_isolated", "t_a", "t_b")
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_rls_probe_FAILS_on_unisolated_table(pg):
    # A table with NO RLS -> the probe must raise AssertionError (leak detected),
    # even on the non-superuser pool, because nothing filters out tenant_a's row.
    await _admin_setup_isolated(pg)  # ensures app_user role exists
    await _admin_setup_unisolated(pg)
    pool = await asyncpg.create_pool(_app_url(pg), min_size=1, max_size=4)
    try:
        with pytest.raises(AssertionError, match="RLS LEAK"):
            await assert_rls_isolates(pool, "probe_unisolated", "t_a", "t_b")
    finally:
        await pool.close()


def test_envelope_check_rejects_bad_shape():
    with pytest.raises(Exception):
        assert_envelope_valid({"event_id": "not-a-ulid", "tenant_id": "flat"})


def test_envelope_check_accepts_valid():
    env = assert_envelope_valid({
        "event_id": "evt_01HZ0Q9KT0R8X4M2WB7C5N3D6F",
        "schema_ref": "sim.case.state-changed/CaseStateChanged/v1",
        "occurred_at": "2026-06-14T12:00:00Z",
        "tenant": {"tenant_id": "t_acme", "lob": "MA"},
        "correlation_id": "case_1", "causation_id": None,
        "actor": {"type": "service", "id": "wf"}, "trace_ref": None, "payload": {},
    })
    assert env.event_id == "evt_01HZ0Q9KT0R8X4M2WB7C5N3D6F"


def test_guard_check_flags_unguarded_adverse():
    with pytest.raises(AssertionError):
        assert_no_adverse_without_guard([{"event_id": "e1", "outcome": "denied"}], guarded_event_ids=set())
    assert_no_adverse_without_guard([{"event_id": "e1", "outcome": "approved"}], guarded_event_ids=set())  # ok
    assert_no_adverse_without_guard([{"event_id": "e2", "outcome": "denied"}], guarded_event_ids={"e2"})    # ok
