"""DLQ admin proxy — gates on saas_admin role, forwards to workflow engine."""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from enstellar_bff.auth import require_saas_admin
from enstellar_bff.config import settings

router = APIRouter(prefix="/bff/admin/dlq", tags=["admin"])


@router.get("/outbox")
async def list_outbox_dlq(auth: tuple = Depends(require_saas_admin)) -> dict[str, Any]:
    _ctx, bearer = auth
    return await _fwd_get("/admin/dlq/outbox", bearer)


@router.get("/consumers")
async def list_consumer_dlq(auth: tuple = Depends(require_saas_admin)) -> dict[str, Any]:
    _ctx, bearer = auth
    return await _fwd_get("/admin/dlq/consumers", bearer)


@router.post("/outbox/{event_id}/reprocess")
async def reprocess_outbox_event(
    event_id: str,
    auth: tuple = Depends(require_saas_admin),
) -> dict[str, Any]:
    _ctx, bearer = auth
    async with httpx.AsyncClient(
        base_url=settings.workflow_engine_url, timeout=10.0
    ) as client:
        r = await client.post(
            f"/admin/dlq/outbox/{event_id}/reprocess",
            headers={"Authorization": f"Bearer {bearer}"},
        )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail=r.json().get("detail", "Not found"))
    r.raise_for_status()
    return r.json()


async def _fwd_get(path: str, bearer: str) -> dict:
    async with httpx.AsyncClient(
        base_url=settings.workflow_engine_url, timeout=10.0
    ) as client:
        r = await client.get(path, headers={"Authorization": f"Bearer {bearer}"})
        r.raise_for_status()
        return r.json()
