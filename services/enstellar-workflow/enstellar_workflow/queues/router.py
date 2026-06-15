"""Queue stats router — rolling 30-day governance aggregates."""
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter

from enstellar_authz import AuthedRequest
from enstellar_workflow.db.connection import get_pool
from simintero_tenant_context import tenant_transaction

router = APIRouter(prefix="/queues", tags=["queues"])


@router.get("/{queue_id}/stats")
async def get_queue_stats(
    queue_id: str,
    auth: AuthedRequest,
) -> dict[str, Any]:
    tenant_id = auth.tenant_id
    pool = await get_pool()
    period_end = date.today()
    period_start = period_end - timedelta(days=30)
    async with tenant_transaction(pool, tenant_id) as conn:
        ai_det = await _ai_determinations(conn, tenant_id, queue_id, period_start)
        adverse_pct = await _adverse_human_signed_pct(conn, tenant_id, period_start)
        sla_pct = await _sla_compliance_expedited_pct(conn, tenant_id, period_start)
    return {
        "ai_determinations": ai_det,
        "adverse_human_signed_pct": round(adverse_pct, 1),
        "sla_compliance_expedited_pct": round(sla_pct, 1),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


async def _ai_determinations(conn, tenant_id: str, queue_id: str, since: date) -> int:
    row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS n FROM workflow_instances
        WHERE tenant_id = $1
          AND assignee_queue = $2
          AND created_at >= $3
          AND case_json->'decisions' @> '[{"auto_approved": true}]'::jsonb
        """,
        tenant_id, queue_id, since,
    )
    return int(row["n"])


async def _adverse_human_signed_pct(conn, tenant_id: str, since: date) -> float:
    """% of adverse-outcome cases that have a recorded human sign-off."""
    row = await conn.fetchrow(
        """
        WITH adverse AS (
            SELECT case_id FROM workflow_instances
            WHERE tenant_id = $1
              AND created_at >= $2
              AND status IN ('adverse', 'denied', 'partially_approved',
                             'partially_denied', 'adverse_modification')
        )
        SELECT
            COUNT(hs.case_id)::float
            / NULLIF(COUNT(a.case_id), 0) * 100 AS pct
        FROM adverse a
        LEFT JOIN human_signoffs hs
               ON hs.case_id = a.case_id AND hs.tenant_id = $1
        """,
        tenant_id, since,
    )
    return float(row["pct"] or 0.0)


async def _sla_compliance_expedited_pct(conn, tenant_id: str, since: date) -> float:
    """% of expedited cases whose SLA clock was NOT breached."""
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE breached_at IS NULL)::float
            / NULLIF(COUNT(*), 0) * 100 AS pct
        FROM clocks
        WHERE tenant_id = $1
          AND urgency = 'expedited'
          AND started_at >= $2
        """,
        tenant_id, since,
    )
    return float(row["pct"] or 0.0)
