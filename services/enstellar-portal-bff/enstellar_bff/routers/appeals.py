"""Thin appeals proxy routes (B1).

Gated by ``require_auth`` (authenticate only — NO role gate): the BFF forwards
the raw bearer to the workflow-engine, which enforces the specific role on the
forwarded token. These routes are pure pass-throughs; engine error statuses
propagate via the central httpx.HTTPStatusError handler in main.py.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from enstellar_bff.auth import require_auth, require_reviewer, require_user
from enstellar_bff.clients.workflow import workflow_client

router = APIRouter(tags=["appeals"])


class AppealBody(BaseModel):
    reason: str | None = None


class AppealDecisionBody(BaseModel):
    outcome: str  # "overturned" | "upheld" (the engine validates)
    reason: str | None = None
    # Upholding an appeal = a continued adverse determination → requires a RECORDED
    # human sign-off. The BFF NEVER accepts a `human_signoff_recorded` boolean from
    # the client (it would be forgeable); it requires this confirmation, records the
    # sign-off server-side, and derives the flag (mirrors submit_adverse_decision).
    sign_off_confirmed: bool = False


class AssignReviewerBody(BaseModel):
    reviewer_id: str


@router.post("/cases/{case_id}/appeals", status_code=201)
async def file_appeal(
    case_id: uuid.UUID,
    body: AppealBody,
    auth: tuple = Depends(require_user),
) -> Any:
    # filed_by is stamped from the authenticated sub — NEVER from the request body
    # (closes the B1 spoofable-filed_by gap). Any authenticated user may file.
    ctx, bearer = auth
    return await workflow_client.file_appeal(
        str(case_id), bearer, filed_by=ctx.sub, reason=body.reason
    )


@router.post("/cases/{case_id}/appeals/{appeal_id}/decision")
async def decide_appeal(
    case_id: uuid.UUID,
    appeal_id: uuid.UUID,
    body: AppealDecisionBody,
    auth: tuple = Depends(require_reviewer),
) -> Any:
    """Decide an appeal. An `upheld` outcome is a continued adverse determination:
    the BFF records the clinician sign-off server-side and derives
    `human_signoff_recorded` — it is NEVER trusted from the client body. Gated by
    `require_reviewer` (the engine requires the reviewer role + the assignment gate
    anyway) so the authenticated reviewer's `sub` is the recorded signer."""
    ctx, bearer = auth
    human_signoff = False
    if body.outcome == "upheld":
        if not body.sign_off_confirmed:
            raise HTTPException(
                status_code=400,
                detail="sign_off_confirmed must be True to uphold an appeal (continued adverse)",
            )
        # Record the sign-off row server-side (audit trail), then derive the flag.
        await workflow_client.record_signoff(
            case_id=str(case_id),
            tenant_id=ctx.tenant_id,
            actor_id=ctx.sub,
            actor_type="clinician",
            outcome_context="appeal_upheld",
        )
        human_signoff = True
    return await workflow_client.decide_appeal(
        str(case_id),
        str(appeal_id),
        bearer,
        outcome=body.outcome,
        reason=body.reason,
        human_signoff_recorded=human_signoff,
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
