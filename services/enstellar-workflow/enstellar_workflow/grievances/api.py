"""Grievance REST API (P5). A grievance is a member complaint — parallel to cases,
never moves a case. Coordinator (grievance_coordinator) acknowledges + assigns;
the assigned investigator (reviewer) resolves."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..auth import AuthedRequest, GrievanceCoordinatorRequest, ReviewerRequest
from ..db.connection import get_pool

router = APIRouter(prefix="/grievances", tags=["grievances"])


class FileGrievanceBody(BaseModel):
    member_ref: str = Field(min_length=1)
    filed_by: str = Field(min_length=1)
    case_id: uuid.UUID | None = None
    category: str | None = None
    description: str | None = None
    urgency: str = "standard"
    lob: str | None = None


class AssignInvestigatorBody(BaseModel):
    investigator_id: str = Field(min_length=1)


class ResolveGrievanceBody(BaseModel):
    resolution: str = Field(min_length=1)


@router.post("", status_code=201, response_model=None)
async def file_grievance(body: FileGrievanceBody, auth: AuthedRequest) -> Any:
    from .service import GrievanceService

    pool = await get_pool()
    return await GrievanceService(pool).file_grievance(
        tenant_id=auth.tenant_id,
        member_ref=body.member_ref,
        case_id=body.case_id,
        category=body.category,
        description=body.description,
        urgency=body.urgency,
        lob=body.lob,
        filed_by=body.filed_by,
    )


@router.post("/{grievance_id}/acknowledgement", status_code=200, response_model=None)
async def acknowledge_grievance(
    grievance_id: uuid.UUID, auth: GrievanceCoordinatorRequest
) -> Any:
    from .service import GrievanceConflictError, GrievanceService

    pool = await get_pool()
    try:
        return await GrievanceService(pool).acknowledge_grievance(
            tenant_id=auth.tenant_id, grievance_id=grievance_id, acknowledged_by=auth.sub
        )
    except GrievanceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{grievance_id}/assignment", status_code=200, response_model=None)
async def assign_investigator(
    grievance_id: uuid.UUID,
    body: AssignInvestigatorBody,
    auth: GrievanceCoordinatorRequest,
) -> Any:
    from .service import GrievanceConflictError, GrievanceService

    pool = await get_pool()
    try:
        return await GrievanceService(pool).assign_investigator(
            tenant_id=auth.tenant_id,
            grievance_id=grievance_id,
            investigator_id=body.investigator_id,
            assigned_by=auth.sub,
        )
    except GrievanceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{grievance_id}/resolution", status_code=200, response_model=None)
async def resolve_grievance(
    grievance_id: uuid.UUID, body: ResolveGrievanceBody, auth: ReviewerRequest
) -> Any:
    from .service import (
        GrievanceConflictError,
        GrievanceNotFoundError,
        GrievanceService,
        NotAssignedError,
    )

    pool = await get_pool()
    try:
        return await GrievanceService(pool).resolve_grievance(
            tenant_id=auth.tenant_id,
            grievance_id=grievance_id,
            resolution=body.resolution,
            resolved_by=auth.sub,
        )
    except GrievanceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NotAssignedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except GrievanceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/assigned", response_model=None)
async def my_assigned_grievances(auth: ReviewerRequest) -> Any:
    from .service import GrievanceService

    pool = await get_pool()
    return await GrievanceService(pool).list_assigned(
        tenant_id=auth.tenant_id, investigator_sub=auth.sub
    )
