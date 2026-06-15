"""BFF queues router — proxies governance stats from the workflow-engine."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.models import QueueStats

router = APIRouter(prefix="/bff/queues", tags=["queues"])


@router.get("/{queue_id}/stats", response_model=QueueStats)
async def get_queue_stats(
    queue_id: str,
    auth: tuple = Depends(require_reviewer),
) -> JSONResponse:
    """Return rolling 30-day governance aggregates for a queue.

    Response is cacheable for 60 s (private, per-user).
    """
    _ctx, bearer = auth
    data = await workflow_client.queue_stats(queue_id, bearer)
    return JSONResponse(
        content=data,
        headers={"Cache-Control": "max-age=60, private"},
    )
