# services/workflow-engine/enstellar_workflow/criteria/router.py
from __future__ import annotations
import uuid
from typing import Any
from fastapi import APIRouter
from enstellar_authz import AuthedRequest
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction
from .repository import CriteriaRepository

router = APIRouter(prefix="/cases", tags=["criteria"])


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
