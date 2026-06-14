# services/workflow-engine/enstellar_workflow/criteria/repository.py
from __future__ import annotations
import json, uuid
from typing import Any
import asyncpg


def _decode_jsonb(val: Any) -> Any:
    """asyncpg may return jsonb columns as JSON strings; decode when necessary."""
    if isinstance(val, str):
        return json.loads(val)
    return val


class CriteriaRepository:
    async def insert_many(self, conn: asyncpg.Connection, rows: list[dict[str, Any]]) -> None:
        """Insert criteria rows produced by the Completeness agent (called by ClinicalReviewConsumer)."""
        for row in rows:
            await conn.execute(
                """
                INSERT INTO case_criteria
                    (id, case_id, tenant_id, criterion_id, text, status, evidence, citations)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
                """,
                uuid.uuid4(),
                row["case_id"],
                row["tenant_id"],
                row["criterion_id"],
                row["text"],
                row["status"],
                json.dumps(row.get("evidence")) if row.get("evidence") is not None else None,
                json.dumps(row.get("citations", [])),
            )

    async def list_by_case(
        self, conn: asyncpg.Connection, case_id: uuid.UUID, tenant_id: str
    ) -> list[dict[str, Any]]:
        rows = await conn.fetch(
            """
            SELECT id, criterion_id, text, status, evidence, citations, created_at
            FROM case_criteria
            WHERE case_id = $1 AND tenant_id = $2
            ORDER BY created_at ASC
            """,
            case_id, tenant_id,
        )
        return [
            {
                "id": str(r["id"]),
                "criterion_id": r["criterion_id"],
                "text": r["text"],
                "status": r["status"],
                "evidence": _decode_jsonb(r["evidence"]) if r["evidence"] is not None else None,
                "citations": _decode_jsonb(r["citations"]) if r["citations"] is not None else [],
            }
            for r in rows
        ]
