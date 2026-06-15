"""SignoffService — records human clinician sign-off for adverse determinations.

Invariant #1: No adverse determination may be issued without a recorded
human sign-off. This service records the sign-off; the TransitionEngine's
adverse_transition_guard enforces that the sign-off exists before the
transition is applied.

All write methods require the caller to be inside a transaction.
"""
from __future__ import annotations

import uuid

import asyncpg

_ALLOWED_ACTOR_TYPES: frozenset[str] = frozenset({"clinician", "physician", "reviewer"})


class SignoffService:
    async def record_signoff(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """Insert or update a human_signoffs row and link it to workflow_instances.

        Uses ON CONFLICT … DO UPDATE so that a second call for the same
        (case_id, tenant_id) pair updates the row rather than erroring.

        The caller must be inside a transaction.

        Returns the full row as a plain dict.
        """
        if actor_type not in _ALLOWED_ACTOR_TYPES:
            raise ValueError(
                f"actor_type must be one of {sorted(_ALLOWED_ACTOR_TYPES)}, got {actor_type!r}"
            )
        row = await conn.fetchrow(
            """
            INSERT INTO human_signoffs
              (case_id, tenant_id, actor_id, actor_type, outcome_context)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (case_id, tenant_id) DO UPDATE
              SET actor_id       = EXCLUDED.actor_id,
                  actor_type     = EXCLUDED.actor_type,
                  signed_at      = now(),
                  outcome_context = EXCLUDED.outcome_context
            RETURNING signoff_id, case_id, tenant_id, actor_id, actor_type,
                      signed_at, outcome_context
            """,
            uuid.UUID(case_id),
            tenant_id,
            actor_id,
            actor_type,
            outcome_context,
        )
        # Link the sign-off to the case row
        status = await conn.execute(
            """
            UPDATE workflow_instances
               SET human_signoff_id = $1
             WHERE case_id = $2 AND tenant_id = $3
            """,
            row["signoff_id"],
            uuid.UUID(case_id),
            tenant_id,
        )
        if status != "UPDATE 1":
            raise ValueError(
                f"workflow_instances row not found for case_id={case_id!r} tenant_id={tenant_id!r}"
            )
        return dict(row)

    async def has_signoff(
        self,
        conn: asyncpg.Connection,
        case_id: str,
        tenant_id: str,
    ) -> bool:
        """Return True if a sign-off row exists for (case_id, tenant_id)."""
        row = await conn.fetchrow(
            "SELECT signoff_id FROM human_signoffs WHERE case_id = $1 AND tenant_id = $2",
            uuid.UUID(case_id),
            tenant_id,
        )
        return row is not None
