"""EventRecorder — writes one immutable row to workflow_events per transition.

All calls require the caller to be inside a transaction. The EventRecorder has
no state; instantiate it freely.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg


class EventRecorder:
    async def record(
        self,
        conn: asyncpg.Connection,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        event_type: str,
        from_state: str | None,
        to_state: str | None,
        actor_id: str,
        actor_type: str,
        correlation_id: str,
        payload: dict[str, Any],
        occurred_at: datetime | None = None,
    ) -> None:
        """Insert one workflow_events row.

        The caller must be inside a transaction. occurred_at defaults to now()
        in UTC if not supplied. Keyword-only arguments prevent positional confusion.
        """
        if occurred_at is None:
            occurred_at = datetime.now(timezone.utc)

        await conn.execute(
            """
            INSERT INTO workflow_events
              (case_id, tenant_id, event_type, from_state, to_state,
               actor_id, actor_type, correlation_id, payload, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
            """,
            case_id,
            tenant_id,
            event_type,
            from_state,
            to_state,
            actor_id,
            actor_type,
            correlation_id,
            json.dumps(payload),
            occurred_at,
        )
