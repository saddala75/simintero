"""DecisionRecorder — appends a Decision to case_json['decisions'] in workflow_instances.

Uses a targeted JSONB update so it does not overwrite other case_json fields.
Must be called inside the caller's transaction, AFTER TransitionEngine.apply()
has already updated the status field.

INVARIANT #5: tenant_id is required on every call and is used as a WHERE
predicate to prevent cross-tenant writes.
"""
from __future__ import annotations

import json
import uuid

import asyncpg

from canonical_model.decision import Decision


class DecisionRecorder:
    """Appends an immutable Decision record to a case's case_json.decisions array.

    Stateless — instantiate freely.
    """

    async def append_decision(
        self,
        conn: asyncpg.Connection,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        decision: Decision,
    ) -> None:
        """Append one Decision to the decisions JSONB array in workflow_instances.

        The caller must be inside a transaction. The update is idempotent
        only in the sense that decision_id is a UUID; if called twice with the
        same Decision, the decision will appear twice in the array — callers
        must ensure at-most-once semantics.

        Uses PostgreSQL || operator on JSONB arrays:
            COALESCE(case_json->'decisions', '[]'::jsonb) || '[{decision}]'::jsonb

        Raises ValueError if no row was updated (case_id + tenant_id not found).
        """
        if not tenant_id or not tenant_id.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")

        decision_json = json.dumps([decision.model_dump(mode="json")])

        row = await conn.fetchrow(
            """
            UPDATE workflow_instances
            SET case_json = jsonb_set(
                case_json,
                '{decisions}',
                COALESCE(case_json->'decisions', '[]'::jsonb) || $1::jsonb
            )
            WHERE case_id = $2 AND tenant_id = $3
            RETURNING case_id
            """,
            decision_json,
            case_id,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No workflow_instances row found for case_id={case_id} "
                f"tenant_id={tenant_id!r} — cannot append decision"
            )
