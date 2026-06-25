"""Thin directory proxy route (B2).

Gated by ``require_auth`` (authenticate only — NO role gate): the BFF forwards
the raw bearer to the workflow-engine ``GET /directory`` and passes through the
optional ``role`` filter. A pure pass-through; engine error statuses propagate
via the central httpx.HTTPStatusError handler in main.py.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from enstellar_bff.auth import require_auth
from enstellar_bff.clients.workflow import workflow_client

router = APIRouter(tags=["directory"])


@router.get("/directory")
async def directory(
    role: str | None = None,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.directory(bearer, role=role)
