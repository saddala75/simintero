"""Reviewer-facing appeals API (worklist). Prefix /appeals.

The per-reviewer worklist is distinct from the queue-based /queues worklist:
this returns the *calling* reviewer's own open assigned appeals.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..auth import ReviewerRequest
from ..db.connection import get_pool

router = APIRouter(prefix="/appeals", tags=["appeals"])


@router.get("/assigned", response_model=None)
async def my_assigned_appeals(auth: ReviewerRequest) -> Any:
    """The calling reviewer's open (under_review) assigned appeals — their worklist."""
    from .service import AppealService

    pool = await get_pool()
    return await AppealService(pool).list_assigned(
        tenant_id=auth.tenant_id, reviewer_sub=auth.sub
    )
