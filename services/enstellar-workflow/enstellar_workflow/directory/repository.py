from __future__ import annotations

import asyncpg


class DirectoryRepository:
    """Reads the directory roster. The `conn` is already inside the caller's
    tenant_transaction (sets sim.tenant_id → RLS isolates rows to the tenant)."""

    async def list(
        self, conn: asyncpg.Connection, *, tenant_id: str, role: str | None = None
    ) -> list[dict]:
        # NOTE: email is intentionally NOT returned — the picker needs only the
        # sub (the assignable id) + display_name + role; staff emails are PII not
        # exposed to every authenticated tenant user.
        rows = await conn.fetch(
            "SELECT sub, display_name, role FROM directory "
            "WHERE tenant_id=$1 AND active AND ($2::text IS NULL OR role=$2) "
            "ORDER BY display_name",
            tenant_id, role,
        )
        return [dict(r) for r in rows]
