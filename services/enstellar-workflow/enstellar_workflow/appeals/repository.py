from __future__ import annotations

import uuid

import asyncpg

from ..engine.guards import ADVERSE_STATES


class AppealsRepository:
    """Reads/writes the appeals table. Every method takes a `conn` already
    inside the caller's tenant_transaction (sets sim.tenant_id → RLS isolates)."""

    async def insert_appeal(
        self,
        conn: asyncpg.Connection,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        level: int,
        appealed_ref: str,
        filed_by: str,
        reason: str | None,
    ) -> dict:
        row = await conn.fetchrow(
            """
            INSERT INTO appeals
                (case_id, tenant_id, level, appealed_ref, filed_by, reason)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            case_id, tenant_id, level, appealed_ref, filed_by, reason,
        )
        return dict(row)

    async def latest_appeal(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str
    ) -> dict | None:
        row = await conn.fetchrow(
            """
            SELECT * FROM appeals
            WHERE case_id = $1 AND tenant_id = $2
            ORDER BY level DESC, created_at DESC
            LIMIT 1
            """,
            case_id, tenant_id,
        )
        return dict(row) if row is not None else None

    async def adverse_determiner(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str
    ) -> str | None:
        """The actor_id of the most-recent human adverse determination for this
        case, sourced from workflow_events (the COI baseline). System/service
        actors are excluded; returns None if no human adverse row exists."""
        row = await conn.fetchrow(
            """
            SELECT actor_id FROM workflow_events
            WHERE case_id = $1 AND tenant_id = $2
              AND to_state = ANY($3::text[])
              AND actor_type NOT IN ('system', 'service')
            ORDER BY occurred_at DESC
            LIMIT 1
            """,
            case_id, tenant_id, list(ADVERSE_STATES),
        )
        return row["actor_id"] if row is not None else None

    async def appeal_at_level(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str, level: int
    ) -> dict | None:
        """The most-recent appeal row at a given level for this case, or None."""
        row = await conn.fetchrow(
            """
            SELECT * FROM appeals
            WHERE case_id = $1 AND tenant_id = $2 AND level = $3
            ORDER BY created_at DESC
            LIMIT 1
            """,
            case_id, tenant_id, level,
        )
        return dict(row) if row is not None else None

    async def fetch(
        self, conn: asyncpg.Connection, appeal_id: uuid.UUID, tenant_id: str
    ) -> dict | None:
        row = await conn.fetchrow(
            "SELECT * FROM appeals WHERE appeal_id = $1 AND tenant_id = $2",
            appeal_id, tenant_id,
        )
        return dict(row) if row is not None else None

    async def assign(
        self,
        conn: asyncpg.Connection,
        *,
        appeal_id: uuid.UUID,
        tenant_id: str,
        reviewer_id: str,
        assigned_by: str,
    ) -> dict | None:
        """Assign a reviewer to an under_review appeal. Returns the updated row,
        or None if the appeal does not exist / is no longer under_review."""
        row = await conn.fetchrow(
            """
            UPDATE appeals
               SET assigned_to = $3, assigned_at = now(), assigned_by = $4
             WHERE appeal_id = $1 AND tenant_id = $2 AND status = 'under_review'
            RETURNING appeal_id, level, status, assigned_to
            """,
            appeal_id, tenant_id, reviewer_id, assigned_by,
        )
        return dict(row) if row is not None else None

    async def record_outcome(
        self,
        conn: asyncpg.Connection,
        *,
        appeal_id: uuid.UUID,
        tenant_id: str,
        status: str,
        outcome_reason: str | None,
        reviewer_actor: str,
    ) -> dict | None:
        """Atomically decide an under_review appeal. Returns the updated row, or
        None if the appeal does not exist / is no longer under_review."""
        row = await conn.fetchrow(
            """
            UPDATE appeals
               SET status = $3,
                   outcome_reason = $4,
                   reviewer_actor = $5,
                   decided_at = now()
             WHERE appeal_id = $1 AND tenant_id = $2 AND status = 'under_review'
            RETURNING *
            """,
            appeal_id, tenant_id, status, outcome_reason, reviewer_actor,
        )
        return dict(row) if row is not None else None
