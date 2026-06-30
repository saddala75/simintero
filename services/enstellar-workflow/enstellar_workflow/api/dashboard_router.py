"""Internal dashboard aggregate endpoint — called by the BFF, not public."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter

from ..auth import AuthedRequest
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction

router = APIRouter(prefix="/internal", tags=["internal"])


@router.get("/dashboard")
async def get_dashboard_stats(auth: AuthedRequest) -> dict[str, Any]:
    tenant_id = auth.tenant_id
    pool = await get_pool()
    async with tenant_transaction(pool, tenant_id) as conn:
        queue = await _queue(conn, tenant_id)
        appeals_data = await _appeals(conn, tenant_id)
        grievances_data = await _grievances(conn, tenant_id)
        ai_data = await _ai(conn, tenant_id)
        my_cases = await _my_cases(conn, tenant_id)
        recent = await _recent_activity(conn, tenant_id)
    return {
        "queue": queue,
        "my_cases": my_cases,
        "appeals": appeals_data,
        "grievances": grievances_data,
        "ai": ai_data,
        "recent_activity": recent,
    }


async def _queue(conn, tenant_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
          COUNT(*) FILTER (WHERE status <> 'closed') AS total_open,
          COUNT(*) FILTER (WHERE status <> 'closed' AND urgency = 'expedited') AS urgent,
          ROUND(
            AVG(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)
            FILTER (WHERE status <> 'closed')
          , 1) AS avg_age_hours
        FROM workflow_instances
        WHERE tenant_id = $1
        """,
        tenant_id,
    )
    at_risk_row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS n FROM clocks
        WHERE tenant_id = $1
          AND clock_type = 'decision'
          AND state = 'running'
          AND warned_at IS NOT NULL
        """,
        tenant_id,
    )
    return {
        "total_open": int(row["total_open"] or 0),
        "urgent": int(row["urgent"] or 0),
        "sla_at_risk": int(at_risk_row["n"] or 0),
        "avg_age_hours": float(row["avg_age_hours"] or 0.0),
    }


async def _appeals(conn, tenant_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('upheld','overturned','withdrawn')) AS open,
          COUNT(*) FILTER (
            WHERE status NOT IN ('upheld','overturned','withdrawn')
              AND filed_at < now() - INTERVAL '30 days'
          ) AS overdue
        FROM appeals
        WHERE tenant_id = $1
        """,
        tenant_id,
    )
    return {"open": int(row["open"] or 0), "overdue": int(row["overdue"] or 0)}


async def _grievances(conn, tenant_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') AS open,
          COUNT(*) FILTER (WHERE status = 'open' AND acknowledged_at IS NULL) AS unacknowledged
        FROM grievances
        WHERE tenant_id = $1
        """,
        tenant_id,
    )
    return {
        "open": int(row["open"] or 0),
        "unacknowledged": int(row["unacknowledged"] or 0),
    }


async def _ai(conn, tenant_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS n
        FROM revital_inflight
        WHERE tenant_id = $1
          AND status = 'done'
          AND completed_at::date = CURRENT_DATE
        """,
        tenant_id,
    )
    return {
        "avg_groundedness": None,
        "cases_reviewed_today": int(row["n"] or 0),
        "cases_with_gaps": None,
    }


async def _my_cases(conn, tenant_id: str) -> list[dict[str, Any]]:
    """Top 5 open cases by soonest SLA deadline (same sort as worklist)."""
    rows = await conn.fetch(
        """
        SELECT
            wi.case_id::text AS case_id,
            wi.lob,
            wi.status,
            wi.urgency,
            wi.case_json,
            c.deadline AS sla_deadline
        FROM workflow_instances wi
        LEFT JOIN clocks c
            ON  c.case_id    = wi.case_id
            AND c.tenant_id  = wi.tenant_id
            AND c.clock_type = 'decision'
            AND c.state IN ('running', 'paused', 'breached')
        WHERE wi.tenant_id = $1
          AND wi.status <> 'closed'
        ORDER BY c.deadline ASC NULLS LAST, wi.created_at DESC
        LIMIT 5
        """,
        tenant_id,
    )
    result = []
    for r in rows:
        raw = r["case_json"]
        case: dict = json.loads(raw) if isinstance(raw, str) else dict(raw)
        member = case.get("member", {})
        name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
        sla_remaining_hours: float | None = None
        if r["sla_deadline"] is not None:
            from datetime import timezone
            import datetime
            now = datetime.datetime.now(tz=timezone.utc)
            delta = r["sla_deadline"] - now
            sla_remaining_hours = round(delta.total_seconds() / 3600, 1)
        result.append({
            "case_id": r["case_id"],
            "member_name": name,
            "lob": r["lob"],
            "urgency": r["urgency"],
            "status": r["status"],
            "sla_remaining_hours": sla_remaining_hours,
        })
    return result


async def _recent_activity(conn, tenant_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT
            we.event_type,
            we.actor_id,
            we.occurred_at,
            we.case_id::text AS case_id,
            wi.case_json->>'member' AS member_json
        FROM workflow_events we
        LEFT JOIN workflow_instances wi
               ON wi.case_id = we.case_id AND wi.tenant_id = we.tenant_id
        WHERE we.tenant_id = $1
        ORDER BY we.occurred_at DESC
        LIMIT 5
        """,
        tenant_id,
    )
    result = []
    for r in rows:
        member: dict = {}
        if r["member_json"]:
            try:
                member = json.loads(r["member_json"])
            except (ValueError, TypeError):
                pass
        member_name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
        result.append({
            "time": r["occurred_at"].strftime("%H:%M"),
            "actor": r["actor_id"],
            "action": r["event_type"],
            "case_id": r["case_id"],
            "member_name": member_name or None,
        })
    return result
