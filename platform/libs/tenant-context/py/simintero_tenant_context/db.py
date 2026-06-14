from __future__ import annotations
from contextlib import asynccontextmanager
import asyncpg

@asynccontextmanager
async def tenant_transaction(pool: asyncpg.Pool, tenant_id: str):
    """Acquire a connection and run a transaction with the RLS GUC set
    transaction-locally (sim.tenant_id), matching the TS db.ts contract.

    Raises ValueError if tenant_id is blank (tenancy invariant).
    """
    if not tenant_id or not tenant_id.strip():
        raise ValueError("tenant_id must not be blank")
    async with pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            await conn.execute("SELECT set_config('sim.tenant_id', $1, true)", tenant_id)
            yield conn
            await tx.commit()
        except Exception:
            await tx.rollback()
            raise
