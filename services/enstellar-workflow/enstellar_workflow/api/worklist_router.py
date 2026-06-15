"""Worklist endpoint — paginated queue view for the reviewer UI.

GET /queues/{queue_id}/worklist
  - tenant_id from Bearer JWT (require_auth)
  - queue_id == "default" returns all cases for the tenant
  - otherwise filters by workflow_instances.assignee_queue
  - LEFT JOINs clocks for the running/paused decision clock deadline (SLA)
  - ordered soonest-deadline first, then by created_at DESC
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..auth import AuthedRequest
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction

router = APIRouter(prefix="/queues", tags=["worklist"])


@router.get("/{queue_id}/worklist", response_model=None)
async def get_worklist(
    queue_id: str,
    auth: AuthedRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
) -> Any:
    """Return a paginated worklist for a queue, enriched with SLA deadlines."""
    tenant_id = auth.tenant_id
    pool = await get_pool()
    offset = (page - 1) * page_size

    async with tenant_transaction(pool, tenant_id) as conn:
        # Total count (no clock join needed)
        total_row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS n
            FROM workflow_instances wi
            WHERE wi.tenant_id = $1
              AND ($2 = 'default' OR wi.assignee_queue = $2)
            """,
            tenant_id,
            queue_id,
        )
        total: int = total_row["n"] if total_row else 0

        rows = await conn.fetch(
            """
            SELECT
                wi.case_id::text  AS case_id,
                wi.lob            AS lob,
                wi.status         AS status,
                wi.urgency        AS urgency,
                wi.case_json      AS case_json,
                c.deadline        AS sla_deadline
            FROM workflow_instances wi
            LEFT JOIN clocks c
                ON  c.case_id   = wi.case_id
                AND c.tenant_id = wi.tenant_id
                AND c.clock_type = 'decision'
                AND c.state IN ('running', 'paused')
            WHERE wi.tenant_id = $1
              AND ($2 = 'default' OR wi.assignee_queue = $2)
            ORDER BY c.deadline ASC NULLS LAST, wi.created_at DESC
            LIMIT $3 OFFSET $4
            """,
            tenant_id,
            queue_id,
            page_size,
            offset,
        )

    items = [_row_to_item(r) for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _row_to_item(row: Any) -> dict:
    raw = row["case_json"]
    case: dict = json.loads(raw) if isinstance(raw, str) else dict(raw)

    member = case.get("member", {})
    name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()

    service_lines: list[dict] = case.get("service_lines", [])

    sla_deadline: str | None = None
    if row["sla_deadline"] is not None:
        sla_deadline = row["sla_deadline"].isoformat()

    return {
        "case_id": row["case_id"],
        "lob": row["lob"],
        "status": row["status"],
        "urgency": row["urgency"],
        "member": {"name": name},
        "service_lines": [
            {"procedure_description": sl.get("procedure_description")}
            for sl in service_lines
        ],
        "sla_deadline": sla_deadline,
    }
