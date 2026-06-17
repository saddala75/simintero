from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.models import SlaInfo, WorklistItem, WorklistPage

router = APIRouter(tags=["worklist"])


def _compute_rag(deadline_iso: str | None) -> SlaInfo | None:
    """Return SlaInfo with RAG color based on hours remaining until deadline.

    green  = hours_remaining > 48
    amber  = 8 < hours_remaining <= 48
    red    = hours_remaining <= 8
    """
    if not deadline_iso:
        return None
    deadline = datetime.fromisoformat(deadline_iso)
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    hours_remaining = (deadline - now).total_seconds() / 3600
    if hours_remaining > 48:
        rag = "green"
    elif hours_remaining > 8:
        rag = "amber"
    else:
        rag = "red"
    return SlaInfo(
        deadline=deadline,
        hours_remaining=hours_remaining,
        rag=rag,
        paused=False,
    )


@router.get("/queues/{queue_id}/worklist", response_model=WorklistPage)
async def get_worklist(
    queue_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    auth: tuple = Depends(require_reviewer),
) -> WorklistPage:
    _ctx, bearer = auth
    data = await workflow_client.get_worklist(bearer, queue_id, page, page_size)
    items: list[WorklistItem] = []
    for c in data.get("items", []):
        sla = _compute_rag(c.get("sla_deadline"))
        items.append(
            WorklistItem(
                case_id=c["case_id"],
                correlation_id=c["correlation_id"],
                member_name=c.get("member", {}).get("name", ""),
                service_description=(
                    c.get("service_lines", [{}])[0].get("procedure_description", "")
                    if c.get("service_lines")
                    else ""
                ),
                lob=c.get("lob", ""),
                status=c.get("status", ""),
                urgency=c.get("urgency", ""),
                sla=sla,
            )
        )
    # Sort soonest-deadline first; items with no SLA go to the end
    items.sort(
        key=lambda x: x.sla.hours_remaining if x.sla is not None else float("inf")
    )
    return WorklistPage(
        items=items,
        total=data.get("total", len(items)),
        page=page,
        page_size=page_size,
    )
