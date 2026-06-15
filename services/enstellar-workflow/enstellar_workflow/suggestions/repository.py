from __future__ import annotations
import json, uuid
from datetime import datetime, timezone
from typing import Any
import asyncpg


class SuggestionsRepository:
    """Insert and retrieve AI-generated suggestions (called by ClinicalReviewConsumer and router)."""

    async def insert_many(self, conn: asyncpg.Connection, rows: list[dict[str, Any]]) -> None:
        """Insert suggestion rows produced by the Triage agent."""
        for row in rows:
            await conn.execute(
                """
                INSERT INTO case_suggestions
                    (id, case_id, tenant_id, agent_id, title, body, confidence, citations)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                """,
                uuid.uuid4(),
                row["case_id"],
                row["tenant_id"],
                row["agent_id"],
                row["title"],
                row["body"],
                row["confidence"],
                json.dumps(row.get("citations", [])),
            )

    async def list_by_case(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str
    ) -> list[dict[str, Any]]:
        rows = await conn.fetch(
            """
            SELECT id, agent_id, title, body, confidence, citations,
                   status, reviewer_id, reviewed_at, created_at
            FROM case_suggestions
            WHERE case_id = $1 AND tenant_id = $2
            ORDER BY created_at ASC
            """,
            case_id, tenant_id,
        )
        return [
            {
                "id": str(r["id"]),
                "agent_id": r["agent_id"],
                "title": r["title"],
                "body": r["body"],
                "confidence": float(r["confidence"]),
                "citations": _decode_jsonb(r["citations"]),
                "status": r["status"],
                "reviewer_id": r["reviewer_id"],
                "reviewed_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
            }
            for r in rows
        ]

    async def record_action(
        self,
        conn: asyncpg.Connection,
        suggestion_id: uuid.UUID,
        case_id: uuid.UUID,
        tenant_id: str,
        action: str,
        reviewer_id: str,
    ) -> bool:
        """Update status/reviewer_id/reviewed_at. Returns True if row was found."""
        now = datetime.now(timezone.utc)
        result = await conn.fetchrow(
            """
            UPDATE case_suggestions
            SET status = $1, reviewer_id = $2, reviewed_at = $3
            WHERE id = $4 AND case_id = $5 AND tenant_id = $6
            RETURNING id
            """,
            action, reviewer_id, now, suggestion_id, case_id, tenant_id,
        )
        return result is not None


def _decode_jsonb(val):
    """Handle asyncpg returning JSONB as string or native Python object."""
    if isinstance(val, str):
        return json.loads(val)
    return val if val is not None else []
