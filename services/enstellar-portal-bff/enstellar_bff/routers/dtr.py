"""BFF DTR router — proxies Questionnaire fetch + QuestionnaireResponse submit to interop."""
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

from enstellar_bff.auth import require_reviewer
from enstellar_bff.clients.fhir import fhir_client

router = APIRouter(prefix="/bff/dtr", tags=["dtr"])


@router.get("/questionnaire")
async def get_questionnaire(
    context: str,
    plan: str,
    auth: tuple = Depends(require_reviewer),
) -> dict[str, Any]:
    ctx, _bearer = auth
    try:
        q = await fhir_client.get_questionnaire(context, plan, ctx.tenant_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="DTR upstream error") from exc
    if not q:
        raise HTTPException(status_code=404, detail="No questionnaire for context")
    return q


@router.post("/questionnaire-response")
async def post_questionnaire_response(
    qr: dict = Body(...),
    auth: tuple = Depends(require_reviewer),
) -> dict[str, Any]:
    ctx, _bearer = auth
    try:
        return await fhir_client.post_questionnaire_response(qr, ctx.tenant_id)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response is not None else 502
        # surface client validation errors (422) to the browser; everything else is 502
        raise HTTPException(status_code=status if status == 422 else 502,
                            detail="DTR submit failed") from exc
