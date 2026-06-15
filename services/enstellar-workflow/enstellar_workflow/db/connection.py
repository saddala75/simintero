"""asyncpg connection pool factory."""
from contextlib import asynccontextmanager

import asyncpg

from ..config import get_settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        dsn = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")
        _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def tenant_conn(pool: asyncpg.Pool, tenant_id: str):
    """Acquire a connection with sim.tenant_id GUC set for RLS row filtering.

    Sets a session-level GUC so all queries on this connection are automatically
    filtered by the RLS tenant_isolation policy. The GUC is reset on exit so the
    connection returns to the pool in a clean state.

    Raises ValueError if tenant_id is blank (invariant #5).
    """
    if not tenant_id or not tenant_id.strip():
        raise ValueError("tenant_id must not be blank — invariant #5")
    async with pool.acquire() as conn:
        await conn.execute(
            "SELECT set_config('sim.tenant_id', $1, false)",
            tenant_id,
        )
        try:
            yield conn
        finally:
            await conn.execute("RESET sim.tenant_id")
