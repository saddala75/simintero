"""FastAPI router for the internal normalization endpoint.

POST /internal/normalize
  Body:  {"bundle": {...}, "tenant_id": "...", "correlation_id": "..."}
  Response 200: canonical Case JSON with extra field "_raw_bundle_key"
  Response 422: {"detail": "<error message>"} on mapping failure

This endpoint is internal-only (not exposed externally). T06's
NormalizationClient.java calls it synchronously from PasClaimSubmitProvider.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..cases.service import CaseService
from ..db.connection import get_pool
from ..engine.transitions import TransitionRequest
from .config import get_normalization_settings
from .mapper import PasBundleMapper
from .storage import MinioStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["normalization"])


async def _get_case_service() -> CaseService:
    pool = await get_pool()
    return CaseService(pool)


class NormalizeRequest(BaseModel):
    bundle: dict[str, Any]
    tenant_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)


@router.post("/normalize", response_model=None)
async def normalize(
    req: NormalizeRequest,
    case_service: CaseService = Depends(_get_case_service),
) -> dict[str, Any]:
    """Store raw bundle in MinIO, map to canonical Case, return Case JSON.

    Store-first pattern: even if mapping fails, the raw bundle is retained
    in MinIO under {tenant_id}/raw-bundles/{date}/{correlation_id}.json.
    """
    settings = get_normalization_settings()
    store = MinioStore(settings)
    mapper = PasBundleMapper()

    try:
        raw_key = store.upload(req.tenant_id, req.correlation_id, req.bundle)
        logger.info(
            "raw_bundle_stored",
            extra={"tenant_id": req.tenant_id, "correlation_id": req.correlation_id, "key": raw_key},
        )
    except Exception as exc:
        logger.error("raw_bundle_store_failed", extra={"error": str(exc)})
        raise HTTPException(status_code=503, detail=f"MinIO store failed: {exc}") from exc

    try:
        case = mapper.map(req.bundle, req.tenant_id, req.correlation_id)
    except ValueError as exc:
        logger.warning(
            "bundle_mapping_failed",
            extra={"tenant_id": req.tenant_id, "correlation_id": req.correlation_id, "error": str(exc)},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # F2: synchronously create the workflow case and kick off auto-determination.
    # create_case is idempotent on correlation_id and RETURNS the persisted case (the
    # original case_id on a duplicate $submit) — use it for the transition so a retried
    # submit doesn't transition a non-existent (freshly-minted) case_id.
    # The kickoff transition advances intake -> auto_determination, emitting a
    # CaseStateChanged the OutboxRelay carries to the AutoDeterminationConsumer.
    case = await case_service.create_case(case)
    await case_service.transition(
        TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state="auto_determination",
            actor_id="system",
            actor_type="system",
            correlation_id=case.correlation_id,
        )
    )

    data = case.model_dump(mode="json")
    data["_raw_bundle_key"] = raw_key
    return data
