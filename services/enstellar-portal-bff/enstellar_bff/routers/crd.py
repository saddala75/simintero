"""BFF CRD router — proxies an in-house EHR simulator's CDS Hook to interop CRD."""
import httpx
from fastapi import APIRouter, Depends, HTTPException

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.crd import crd_client
from enstellar_bff.models import CrdCard, CrdHookRequest

router = APIRouter(prefix="/bff/crd", tags=["crd"])


@router.post("/invoke", response_model=list[CrdCard])
async def invoke(
    body: CrdHookRequest,
    auth: tuple = Depends(require_reviewer),
) -> list[CrdCard]:
    ctx, _bearer = auth
    cds_request = {
        "hook": body.hook,
        "hookInstance": "sim-" + body.service_code,
        "context": {
            "serviceCode": body.service_code,
            "patientId": body.patient_id,
            "planId": body.plan_id,
        },
    }
    try:
        result = await crd_client.invoke(body.hook, cds_request, ctx.tenant_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="CRD upstream error") from exc
    return result.get("cards", [])
