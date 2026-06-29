# services/workflow-engine/enstellar_workflow/criteria/router.py
from __future__ import annotations
import uuid
from typing import Any, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..auth import AuthedRequest
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction
from .repository import CriteriaRepository

router = APIRouter(prefix="/cases", tags=["criteria"])


class UpdateCriterionBody(BaseModel):
    status: Literal["met", "gap", "unknown"]


@router.get("/{case_id}/criteria", response_model=None)
async def get_criteria(
    case_id: uuid.UUID,
    auth: AuthedRequest,
) -> Any:
    """Return all criteria for a case, tenant-scoped."""
    pool = await get_pool()
    repo = CriteriaRepository()
    async with tenant_transaction(pool, auth.tenant_id) as conn:
        return await repo.list_by_case(conn, case_id, auth.tenant_id)


@router.patch("/{case_id}/criteria/{criterion_id}", response_model=None)
async def update_criterion_status(
    case_id: uuid.UUID,
    criterion_id: uuid.UUID,
    body: UpdateCriterionBody,
    auth: AuthedRequest,
) -> dict:
    """Update the status of a single criterion row (used by Revital AI review)."""
    pool = await get_pool()
    repo = CriteriaRepository()
    async with tenant_transaction(pool, auth.tenant_id) as conn:
        updated = await repo.update_status(conn, criterion_id, case_id, auth.tenant_id, body.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Criterion not found")
    return {"status": body.status}

