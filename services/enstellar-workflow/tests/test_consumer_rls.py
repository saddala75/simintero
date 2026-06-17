import json
import uuid
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest

from simintero_tenant_context import tenant_transaction


async def test_tenant_transaction_write_succeeds_under_force_rls(db_dsn):
    admin = await asyncpg.connect(db_dsn)
    role = f"rlsuser_{uuid.uuid4().hex[:8]}"
    await admin.execute(f'CREATE ROLE "{role}" LOGIN PASSWORD \'x\'')
    await admin.execute(f'GRANT USAGE ON SCHEMA shared TO "{role}"')
    await admin.execute(f'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA shared TO "{role}"')
    await admin.close()

    parts = urlsplit(db_dsn)
    role_dsn = urlunsplit((parts.scheme, f"{role}:x@{parts.hostname}:{parts.port}", parts.path, "", ""))
    pool = await asyncpg.create_pool(role_dsn, min_size=1, max_size=2)
    try:
        tenant = f"tenant-rls-{uuid.uuid4().hex[:6]}"
        # Bare write (no GUC) must FAIL the WITH CHECK under FORCE RLS:
        with pytest.raises(asyncpg.PostgresError):
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id) "
                        "VALUES ($1,$2,$3,$4::jsonb,$5)",
                        f"evt_{uuid.uuid4().hex}", "sim.case.lifecycle", "k", json.dumps({}), tenant,
                    )
        # tenant_transaction write (GUC set) must SUCCEED:
        async with tenant_transaction(pool, tenant) as conn:
            await conn.execute(
                "INSERT INTO shared.outbox (event_id, topic, key, envelope, tenant_id) "
                "VALUES ($1,$2,$3,$4::jsonb,$5)",
                f"evt_{uuid.uuid4().hex}", "sim.case.lifecycle", "k", json.dumps({}), tenant,
            )
        async with tenant_transaction(pool, tenant) as conn:
            n = await conn.fetchval("SELECT count(*) FROM shared.outbox WHERE tenant_id=$1", tenant)
        assert n == 1
    finally:
        await pool.close()
