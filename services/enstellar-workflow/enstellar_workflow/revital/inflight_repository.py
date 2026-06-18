from __future__ import annotations
import uuid
from typing import Any
import asyncpg


class InflightRepository:
    """Reads/writes revital_inflight. Tenant-row ops run inside tenant_transaction
    (sets sim.tenant_id); the cross-tenant scan (list_processing) is called on a
    sim_relay (BYPASSRLS) connection, exactly like OutboxRelay."""

    async def insert(
        self,
        conn: asyncpg.Connection,
        *,
        analysis_id: str,
        case_id: uuid.UUID,
        tenant_id: str,
        correlation_id: str,
    ) -> None:
        await conn.execute(
            """
            INSERT INTO revital_inflight (analysis_id, case_id, tenant_id, correlation_id, status)
            VALUES ($1, $2, $3, $4, 'processing')
            ON CONFLICT (analysis_id) DO NOTHING
            """,
            analysis_id, case_id, tenant_id, correlation_id,
        )

    async def exists_processing_for_case(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str
    ) -> bool:
        row = await conn.fetchrow(
            """
            SELECT 1 FROM revital_inflight
            WHERE case_id = $1 AND tenant_id = $2 AND status = 'processing'
            LIMIT 1
            """,
            case_id, tenant_id,
        )
        return row is not None

    async def list_processing(
        self, conn: asyncpg.Connection, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Cross-tenant scan — caller MUST pass a sim_relay (BYPASSRLS) connection inside a tx."""
        rows = await conn.fetch(
            """
            SELECT analysis_id, case_id, tenant_id, correlation_id, submitted_at
            FROM revital_inflight WHERE status = 'processing'
            ORDER BY submitted_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
            """,
            limit,
        )
        return [dict(r) for r in rows]

    async def claim(self, conn: asyncpg.Connection, analysis_id: str) -> bool:
        """Atomically transition processing→done. Returns True if THIS caller won
        the claim (row was still 'processing'), False if already finalized.

        Run inside the per-tenant tenant_transaction BEFORE writing advisory rows:
        because it shares that transaction with the inserts/publish, a later
        failure rolls back the claim too and the row returns to 'processing'.
        """
        status = await conn.execute(
            """UPDATE revital_inflight SET status = 'done', completed_at = now()
               WHERE analysis_id = $1 AND status = 'processing'""",
            analysis_id,
        )
        # asyncpg execute() returns the command tag, e.g. "UPDATE 1" / "UPDATE 0";
        # matches the existing idiom in escalation/signoff services.
        return status == "UPDATE 1"

    async def mark_done(self, conn: asyncpg.Connection, analysis_id: str) -> None:
        await conn.execute(
            "UPDATE revital_inflight SET status = 'done', completed_at = now() WHERE analysis_id = $1",
            analysis_id,
        )
