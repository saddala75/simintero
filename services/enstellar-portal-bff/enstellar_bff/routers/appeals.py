"""Thin appeals proxy routes (B1).

Gated by ``require_auth`` (authenticate only — NO role gate): the BFF forwards
the raw bearer to the workflow-engine, which enforces the specific role on the
forwarded token. These routes are pure pass-throughs; engine error statuses
propagate via the central httpx.HTTPStatusError handler in main.py.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from enstellar_bff.auth import require_auth
from enstellar_bff.clients.workflow import workflow_client

router = APIRouter(tags=["appeals"])


class AppealBody(BaseModel):
    filed_by: str
    reason: str | None = None


class AppealDecisionBody(BaseModel):
    outcome: str
    reason: str | None = None
    human_signoff_recorded: bool = False


class AssignReviewerBody(BaseModel):
    reviewer_id: str


@router.post("/cases/{case_id}/appeals", status_code=201)
async def file_appeal(
    case_id: uuid.UUID,
    body: AppealBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.file_appeal(
        str(case_id), bearer, filed_by=body.filed_by, reason=body.reason
    )


@router.post("/cases/{case_id}/appeals/{appeal_id}/decision")
async def decide_appeal(
    case_id: uuid.UUID,
    appeal_id: uuid.UUID,
    body: AppealDecisionBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.decide_appeal(
        str(case_id),
        str(appeal_id),
        bearer,
        outcome=body.outcome,
        reason=body.reason,
        human_signoff_recorded=body.human_signoff_recorded,
    )


@router.post("/cases/{case_id}/appeals/{appeal_id}/assignment")
async def assign_appeal_reviewer(
    case_id: uuid.UUID,
    appeal_id: uuid.UUID,
    body: AssignReviewerBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.assign_appeal_reviewer(
        str(case_id), str(appeal_id), bearer, reviewer_id=body.reviewer_id
    )


@router.get("/appeals/assigned")
async def list_assigned_appeals(
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.list_assigned_appeals(bearer)
