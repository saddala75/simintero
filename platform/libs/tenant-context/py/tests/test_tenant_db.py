import pytest
import asyncpg
from testcontainers.postgres import PostgresContainer
from simintero_tenant_context.db import tenant_transaction

# The testcontainers default role is a SUPERUSER, and Postgres superusers
# bypass RLS unconditionally (even with FORCE ROW LEVEL SECURITY). To prove
# real RLS isolation we must connect as a non-superuser app role. The admin
# URL is used only to provision the schema + a non-superuser "app" role; the
# tenant transactions run on a pool connected as that app role.
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


async def _setup(admin_url: str):
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f"""
            DROP TABLE IF EXISTS note;
            CREATE TABLE note (tenant_id text not null, body text);
            ALTER TABLE note ENABLE ROW LEVEL SECURITY;
            ALTER TABLE note FORCE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS tenant_isolation ON note;
            CREATE POLICY tenant_isolation ON note
              USING (tenant_id = current_setting('sim.tenant_id', true));
            DROP ROLE IF EXISTS {APP_USER};
            CREATE ROLE {APP_USER} LOGIN PASSWORD '{APP_PASSWORD}';
            GRANT SELECT, INSERT, UPDATE, DELETE ON note TO {APP_USER};
        """)
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_rls_isolates_tenants_via_transaction_local_guc(pg):
    await _setup(pg)
    pool = await asyncpg.create_pool(_app_url(pg), min_size=1, max_size=4)
    try:
        async with tenant_transaction(pool, "t_a") as conn:
            await conn.execute("INSERT INTO note(tenant_id, body) VALUES ('t_a','secret-a')")
        async with tenant_transaction(pool, "t_b") as conn:
            await conn.execute("INSERT INTO note(tenant_id, body) VALUES ('t_b','secret-b')")
            rows = await conn.fetch("SELECT body FROM note")
            assert [r["body"] for r in rows] == ["secret-b"]
        async with tenant_transaction(pool, "t_a") as conn:
            rows = await conn.fetch("SELECT body FROM note")
            assert [r["body"] for r in rows] == ["secret-a"]
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_blank_tenant_is_rejected(pg):
    pool = await asyncpg.create_pool(pg, min_size=1, max_size=2)
    try:
        with pytest.raises(ValueError):
            async with tenant_transaction(pool, "   ") as _conn:
                pass
    finally:
        await pool.close()
