"""Platform dashboard — aggregated daily summary for the post-login landing page."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends
from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.config import settings

router = APIRouter(prefix="/bff/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(auth: tuple = Depends(require_reviewer)) -> dict:
    """Aggregated daily summary for the platform dashboard."""
    ctx, bearer = auth
    tenant_id = ctx.tenant_id

    # Fetch workflow aggregates and VKAS stats concurrently.
    import asyncio
    workflow_task = asyncio.create_task(workflow_client.dashboard_stats(bearer))
    vkas_task = asyncio.create_task(_vkas_stats(tenant_id))
    workflow_data, vkas_data = await asyncio.gather(workflow_task, vkas_task)

    policies_active: int | None = (vkas_data.get("by_status") or {}).get("active")

    return {
        "queue": workflow_data.get("queue", {}),
        "my_cases": workflow_data.get("my_cases", []),
        "appeals": workflow_data.get("appeals", {}),
        "grievances": workflow_data.get("grievances", {}),
        "ai": workflow_data.get("ai", {}),
        "policies": {
            "active": policies_active,
            "drafts_pending": (vkas_data.get("by_status") or {}).get("draft"),
            "elm_compliance": None,
        },
        "quality": {
            "active_measures": None,
            "care_gaps_open": None,
            "top_gap_measure": None,
        },
        "recent_activity": workflow_data.get("recent_activity", []),
    }


async def _vkas_stats(tenant_id: str) -> dict:
    """Call VKAS /v1/stats with the tenant header. Returns empty dict on failure."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{settings.vkas_base_url}/v1/stats",
                headers={"x-sim-tenant-id": tenant_id},
            )
            r.raise_for_status()
            return r.json()
    except Exception:
        return {}
