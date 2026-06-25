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
import uuid
from typing import Any

from canonical_model import Status
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from ..cases.service import CaseService
from ..db.connection import get_pool
from ..engine.auto_determination import _stable_member_ref
from ..engine.transitions import TransitionRequest
from ..outbox.publisher import OutboxPublisher
from .config import get_normalization_settings
from .fabric_writer import write_case_evidence
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


class RfiResponseRequest(BaseModel):
    bundle: dict[str, Any]
    tenant_id: str = Field(min_length=1)
    case_id: uuid.UUID


@router.post("/normalize", response_model=None)
async def normalize(
    req: NormalizeRequest,
    request: Request,
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

    # slice 2.1: bridge the case's clinical evidence into fabric.resource BEFORE
    # auto_determination runs, so the very first Digicore decision sees it. This is
    # BEST-EFFORT: any failure is caught + logged and $submit still succeeds (the
    # decision then sees no evidence → clinical_review, which is safe). The write is
    # keyed by the bare Patient logical id (member_ref) Digicore retrieves by.
    try:
        member_logical_id = _stable_member_ref(case)
        if member_logical_id:
            n = await write_case_evidence(
                request.app.state.fabric_pool,
                case.tenant_id,
                member_logical_id,
                raw_key,
                req.bundle,
            )
            logger.info("fabric bridge wrote %d evidence rows for case=%s", n, case.case_id)
    except Exception:  # best-effort: NEVER break $submit
        logger.warning(
            "fabric bridge failed for case=%s (continuing)",
            getattr(case, "case_id", "?"),
            exc_info=True,
        )

    # Only kick off auto-determination for a freshly-created case. On a duplicate $submit,
    # create_case returns the EXISTING case at its current status; re-transitioning would
    # regress a case the async pipeline (or a human) has already advanced.
    if case.status == Status.intake:
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


@router.post("/rfi-response", response_model=None)
async def rfi_response(
    req: RfiResponseRequest,
    request: Request,
    case_service: CaseService = Depends(_get_case_service),
) -> dict[str, Any]:
    """Provider RFI response (supplemental FHIR bundle).

    Writes the bundle's clinical evidence to fabric.resource as SUBMITTED
    (source='rfi-response') under the case's stable member_ref, THEN publishes
    RFIResponseReceived. The RfiResponseConsumer re-gates pend_rfi ->
    auto_determination.

    Cross-DB note: fabric.resource lives in the FABRIC pool while shared.outbox
    lives in the WORKFLOW pool — DIFFERENT databases, so they cannot share one
    transaction. We write the evidence FIRST, then publish the event
    (evidence-before-event). A publish failure after the fabric write leaves the
    idempotent-upserted evidence written but no event → the case stays pend_rfi,
    safe to retry. We do NOT swallow the publish error (it raises a 500 so the
    caller retries).
    """
    # 1. Resolve the case (workflow pool) + require pend_rfi.
    async with tenant_transaction(case_service._pool, req.tenant_id) as conn:
        case = await case_service._repo.fetch_by_id(conn, req.case_id, req.tenant_id)
    if case is None:
        raise HTTPException(status_code=404, detail="case not found")
    if case.status.value != "pend_rfi":
        raise HTTPException(
            status_code=409, detail=f"case is {case.status.value}, not pend_rfi"
        )
    member_ref = _stable_member_ref(case)
    if not member_ref:
        raise HTTPException(status_code=422, detail="case has no stable member_ref")

    # Unlike the best-effort intake bridge, this endpoint's whole purpose IS the
    # fabric write — an unset fabric pool must fail loudly (503), not silently
    # re-gate the case having ingested zero evidence.
    if request.app.state.fabric_pool is None:
        raise HTTPException(status_code=503, detail="fabric store unavailable")

    # 2. Write the response evidence to fabric as SUBMITTED (fabric pool) — EVIDENCE FIRST.
    n = await write_case_evidence(
        request.app.state.fabric_pool,
        req.tenant_id,
        member_ref,
        f"rfi-response:{req.case_id}",
        req.bundle,
        source="rfi-response",
    )
    logger.info("rfi-response wrote %d fabric rows for case=%s", n, req.case_id)

    # 3. Publish RFIResponseReceived (workflow pool shared.outbox) — EVENT AFTER.
    async with tenant_transaction(case_service._pool, req.tenant_id) as conn:
        event = make_envelope(
            SchemaRef.RFI_RESPONSE_RECEIVED,
            tenant_id=req.tenant_id,
            actor_id="system",
            actor_type="system",
            correlation_id=str(case.correlation_id),
            payload={"case_id": str(req.case_id)},
        )
        await OutboxPublisher().publish(conn, event)

    return {
        "case_id": str(req.case_id),
        "fabric_rows": n,
        "status": "rfi_response_received",
    }
