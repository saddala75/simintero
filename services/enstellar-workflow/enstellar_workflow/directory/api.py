"""Directory roster REST API (B2).

GET /directory returns the tenant's assignable reviewers/investigators (a
seeded name → real Keycloak sub roster) so a coordinator picks a real person
instead of pasting a raw sub. RLS-isolated to the caller's tenant.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from simintero_tenant_context import tenant_transaction

from ..auth import AuthedRequest
from ..db.connection import get_pool
from .repository import DirectoryRepository

router = APIRouter(prefix="/directory", tags=["directory"])


@router.get("", response_model=None)
async def list_directory(auth: AuthedRequest, role: str | None = None) -> Any:
    """The tenant's assignable reviewers/investigators (optional ?role= filter)."""
    pool = await get_pool()
    async with tenant_transaction(pool, auth.tenant_id) as conn:
        return await DirectoryRepository().list(conn, tenant_id=auth.tenant_id, role=role)
