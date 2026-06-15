"""CaseRepository — asyncpg CRUD for workflow_instances.

All write methods require the caller to be inside a transaction. This is
intentional: callers (TransitionEngine, CaseService) compose multiple writes
atomically and own the transaction boundary.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

import asyncpg

from canonical_model import Case, Status


class CaseRepository:
    async def insert(self, conn: asyncpg.Connection, case: Case) -> None:
        """Insert a new workflow_instances row.

        The caller must be inside a transaction.
        Does NOT handle ON CONFLICT — use CaseService.create_case for idempotent inserts.
        """
        await conn.execute(
            """
            INSERT INTO workflow_instances
              (case_id, tenant_id, correlation_id, lob, program, status, urgency,
               workflow_def_version, case_json, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
            """,
            case.case_id,
            case.tenant_id,
            case.correlation_id,
            case.lob,
            case.program,
            case.status.value,
            case.urgency.value,
            "v1",
            json.dumps(case.model_dump(mode="json")),
            case.created_at,
            case.updated_at,
        )

    async def fetch_by_id(
        self,
        conn: asyncpg.Connection,
        case_id: uuid.UUID,
        tenant_id: str,
    ) -> Case | None:
        """Fetch a case by primary key, scoped to tenant."""
        row = await conn.fetchrow(
            "SELECT case_json FROM workflow_instances "
            "WHERE case_id = $1 AND tenant_id = $2",
            case_id,
            tenant_id,
        )
        if row is None:
            return None
        return _deserialize_case(row["case_json"])

    async def fetch_by_correlation_id(
        self,
        conn: asyncpg.Connection,
        correlation_id: str,
        tenant_id: str,
    ) -> Case | None:
        """Fetch a case by its idempotency key, scoped to tenant."""
        row = await conn.fetchrow(
            "SELECT case_json FROM workflow_instances "
            "WHERE correlation_id = $1 AND tenant_id = $2",
            correlation_id,
            tenant_id,
        )
        if row is None:
            return None
        return _deserialize_case(row["case_json"])

    async def update_status(
        self,
        conn: asyncpg.Connection,
        case: Case,
        new_status: str,
        updated_at: datetime,
    ) -> None:
        """Update status + case_json snapshot in workflow_instances.

        The caller must be inside a transaction.
        Constructs an updated Case by copying the existing one with the new
        status, then serializes it back to JSONB.
        """
        updated_case = case.model_copy(
            update={"status": Status(new_status), "updated_at": updated_at}
        )
        await conn.execute(
            """
            UPDATE workflow_instances
            SET status = $1, case_json = $2::jsonb, updated_at = $3
            WHERE case_id = $4 AND tenant_id = $5
            """,
            new_status,
            json.dumps(updated_case.model_dump(mode="json")),
            updated_at,
            case.case_id,
            case.tenant_id,
        )


def _deserialize_case(raw: object) -> Case:
    """Normalize asyncpg JSONB output (may be dict or str) and parse as Case."""
    if isinstance(raw, str):
        return Case.model_validate_json(raw)
    return Case.model_validate(raw)
