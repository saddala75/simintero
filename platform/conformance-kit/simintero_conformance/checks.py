from __future__ import annotations
import asyncpg
from canonical_model import EventEnvelope

async def assert_rls_isolates(pool: asyncpg.Pool, table: str, tenant_a: str, tenant_b: str) -> None:
    """Probe: with the GUC set to tenant_b, a SELECT must NOT return tenant_a rows.
    Assumes `table` has a tenant_id column + FORCE RLS tenant_isolation policy, and
    that `pool` connects as a NON-SUPERUSER role (superusers bypass RLS)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('sim.tenant_id', $1, true)", tenant_b)
            leaked = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE tenant_id = $1", tenant_a
            )
    if leaked != 0:
        raise AssertionError(f"RLS LEAK: tenant {tenant_b} saw {leaked} rows of tenant {tenant_a} in {table}")

def assert_envelope_valid(raw: dict) -> EventEnvelope:
    """Validate a raw event dict against the published platform envelope."""
    return EventEnvelope.model_validate(raw)

def assert_no_adverse_without_guard(emitted_decisions: list[dict], guarded_event_ids: set[str]) -> None:
    """Every adverse determination must have passed the OPA guard (its event_id present in the guarded set)."""
    for d in emitted_decisions:
        if d.get("outcome") in {"denied", "partially_denied", "adverse_modification"}:
            if d.get("event_id") not in guarded_event_ids:
                raise AssertionError(f"Adverse determination {d.get('event_id')} bypassed the OPA guard")
