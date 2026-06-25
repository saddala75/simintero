"""Thin grievance proxy routes (B1).

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

from enstellar_bff.auth import require_auth, require_user
from enstellar_bff.clients.workflow import workflow_client

router = APIRouter(tags=["grievances"])


class FileGrievanceBody(BaseModel):
    member_ref: str
    case_id: uuid.UUID | None = None
    category: str | None = None
    description: str | None = None
    urgency: str = "standard"
    lob: str | None = None


class AssignInvestigatorBody(BaseModel):
    investigator_id: str


class ResolveGrievanceBody(BaseModel):
    resolution: str


@router.post("/grievances", status_code=201)
async def file_grievance(
    body: FileGrievanceBody,
    auth: tuple = Depends(require_user),
) -> Any:
    # filed_by is stamped from the authenticated sub — NEVER from the request body
    # (closes the B1 spoofable-filed_by gap). member_ref stays body-supplied (the
    # member the grievance is ABOUT, distinct from WHO filed it). Any authenticated
    # user may file.
    ctx, bearer = auth
    return await workflow_client.file_grievance(
        bearer,
        member_ref=body.member_ref,
        filed_by=ctx.sub,
        case_id=str(body.case_id) if body.case_id else None,
        category=body.category,
        description=body.description,
        urgency=body.urgency,
        lob=body.lob,
    )


@router.post("/grievances/{grievance_id}/acknowledgement")
async def acknowledge_grievance(
    grievance_id: uuid.UUID,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.acknowledge_grievance(str(grievance_id), bearer)


@router.post("/grievances/{grievance_id}/assignment")
async def assign_investigator(
    grievance_id: uuid.UUID,
    body: AssignInvestigatorBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.assign_investigator(
        str(grievance_id), bearer, investigator_id=body.investigator_id
    )


@router.post("/grievances/{grievance_id}/resolution")
async def resolve_grievance(
    grievance_id: uuid.UUID,
    body: ResolveGrievanceBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.resolve_grievance(
        str(grievance_id), bearer, resolution=body.resolution
    )


@router.get("/grievances/assigned")
async def list_assigned_grievances(
    auth: tuple = Depends(require_auth),
) -> Any:
    _ctx, bearer = auth
    return await workflow_client.list_assigned_grievances(bearer)
