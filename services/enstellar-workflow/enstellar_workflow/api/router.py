"""FastAPI router — case lifecycle REST endpoints.

Endpoints:
    POST   /cases                        Create a case (idempotent on correlation_id)
    GET    /cases/{case_id}              Fetch a case by ID
    GET    /cases/{case_id}/events       Fetch full event history for a case
    POST   /cases/{case_id}/transitions  Apply a state transition

tenant_id:
    POST /cases: taken from the Case body (case.tenant_id).
    GET  /cases/{id} and GET /cases/{id}/events: Bearer JWT (require_auth).
    POST /cases/{id}/pend-rfi: Bearer JWT (require_auth).
    POST /cases/{id}/transitions: included in the TransitionBody.
"""
from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException

from ..auth import AuthedRequest
from pydantic import BaseModel

from canonical_model import Case
from ..cases.service import CaseService
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction
from ..engine.guards import GuardError
from ..engine.transitions import TransitionRequest

router = APIRouter(prefix="/cases", tags=["cases"])


class ActorType(StrEnum):
    """Legacy actor-type enum kept for request validation on /escalate.

    Values map to the platform actor types via make_envelope (user→human,
    system→service, service→service).
    """

    USER = "user"
    SYSTEM = "system"
    SERVICE = "service"


class TransitionBody(BaseModel):
    """Request body for POST /cases/{case_id}/transitions."""

    tenant_id: str
    to_state: str
    actor_id: str
    actor_type: str  # 'user' | 'system' | 'service'
    correlation_id: str
    payload: dict = {}
    human_signoff_recorded: bool = False


class PendRfiBody(BaseModel):
    """Request body for POST /cases/{case_id}/pend-rfi."""

    provider_npi: str
    document_types: list[str]
    free_text: str | None = None


class EscalateBody(BaseModel):
    """Request body for POST /cases/{case_id}/escalate."""

    tenant_id: str
    actor_id: str
    actor_type: ActorType  # validated by Pydantic, returns 422 on invalid value
    reason: str | None = None


class SignoffBody(BaseModel):
    """Request body for POST /cases/{case_id}/human-signoff."""

    tenant_id: str
    actor_id: str
    actor_type: Literal["clinician", "physician", "reviewer"]
    outcome_context: str


class AppealBody(BaseModel):
    """Request body for POST /cases/{case_id}/appeals."""

    filed_by: str
    reason: str | None = None


class AppealDecisionBody(BaseModel):
    """Request body for POST /cases/{case_id}/appeals/{appeal_id}/decision."""

    outcome: Literal["overturned", "upheld"]
    reviewer_actor: str
    reason: str | None = None
    human_signoff_recorded: bool = False


async def _get_service() -> CaseService:
    pool = await get_pool()
    return CaseService(pool)


@router.post("", status_code=201, response_model=None)
async def create_case(
    case: Case,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Create a case. Idempotent on correlation_id scoped to tenant_id."""
    result = await service.create_case(case)
    return result.model_dump(mode="json")


@router.get("/{case_id}", response_model=None)
async def get_case(
    case_id: uuid.UUID,
    auth: AuthedRequest,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Fetch a case by ID, scoped to tenant."""
    tenant_id = auth.tenant_id
    pool = await get_pool()
    from ..cases.repository import CaseRepository

    async with tenant_transaction(pool, tenant_id) as conn:
        case = await CaseRepository().fetch_by_id(conn, case_id, tenant_id)

    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    return case.model_dump(mode="json")


@router.get("/{case_id}/events", response_model=None)
async def get_case_events(
    case_id: uuid.UUID,
    auth: AuthedRequest,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Return the full immutable event history for a case, ordered by id ASC."""
    return await service.get_events(case_id, auth.tenant_id)


@router.post("/{case_id}/transitions", response_model=None)
async def transition_case(
    case_id: uuid.UUID,
    body: TransitionBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Apply a state transition.

    Returns 200 with the updated Case on success.
    Returns 409 if a guard rejects the transition (e.g. adverse state without sign-off).
    Returns 409 if the target state starts with 'appeal_' — those transitions must
    go through POST /cases/{id}/appeals or POST /cases/{id}/appeals/{id}/decision
    so the COI guard and sign-off gate in AppealService are always enforced.
    """
    if body.to_state.startswith("appeal_"):
        raise HTTPException(
            status_code=409,
            detail="appeal transitions must go through the appeals API",
        )

    req = TransitionRequest(
        case_id=case_id,
        tenant_id=body.tenant_id,
        to_state=body.to_state,
        actor_id=body.actor_id,
        actor_type=body.actor_type,
        correlation_id=body.correlation_id,
        payload=body.payload,
        human_signoff_recorded=body.human_signoff_recorded,
    )
    try:
        case = await service.transition(req)
    except GuardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return case.model_dump(mode="json")


@router.post("/{case_id}/pend-rfi", status_code=200)
async def pend_rfi(
    case_id: uuid.UUID,
    body: PendRfiBody,
    auth: AuthedRequest,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Transition case to pend_rfi state, pause clock, and dispatch RFI.

    All three side-effects occur atomically in a single transaction.
    Returns the updated case status and the RFI request_id.
    """
    tenant_id = auth.tenant_id
    try:
        result = await service.pend_rfi(
            case_id=case_id,
            tenant_id=tenant_id,
            provider_npi=body.provider_npi,
            document_types=body.document_types,
            free_text=body.free_text,
            requested_by="reviewer",
        )
    except GuardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    case = result["case"]
    return {
        "case_id": str(case.case_id),
        "status": case.status.value,
        "rfi_request_id": result["rfi_request_id"],
    }


@router.post("/{case_id}/appeals", status_code=201, response_model=None)
async def file_appeal(
    case_id: uuid.UUID,
    body: AppealBody,
    auth: AuthedRequest,
) -> Any:
    """File an appeal on an adverse case → appeal_review (appeal clock + notice).

    Returns 201 with {'appeal_id', 'level', 'status': 'appeal_review'}.
    Returns 409 if the case is not eligible for an appeal.
    """
    from ..appeals.service import AppealNotAllowedError, AppealService

    pool = await get_pool()
    try:
        return await AppealService(pool).file_appeal(
            case_id=case_id,
            tenant_id=auth.tenant_id,
            filed_by=body.filed_by,
            reason=body.reason,
        )
    except AppealNotAllowedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/{case_id}/appeals/{appeal_id}/decision",
    status_code=200,
    response_model=None,
)
async def decide_appeal(
    case_id: uuid.UUID,
    appeal_id: uuid.UUID,
    body: AppealDecisionBody,
    auth: AuthedRequest,
) -> Any:
    """Decide an appeal — overturn or uphold (uphold requires human sign-off).

    Returns 200 with {'appeal_id', 'outcome', 'status'}.
    Returns 422 if an uphold is attempted without a recorded human sign-off.
    Returns 409 if the appeal is no longer under_review.
    """
    from ..appeals.service import AppealConflictError, AppealService, COIError

    pool = await get_pool()
    try:
        return await AppealService(pool).decide_appeal(
            case_id=case_id,
            tenant_id=auth.tenant_id,
            appeal_id=appeal_id,
            outcome=body.outcome,
            reviewer_actor=body.reviewer_actor,
            reason=body.reason,
            human_signoff_recorded=body.human_signoff_recorded,
        )
    except GuardError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except COIError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AppealConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{case_id}/escalate", response_model=None)
async def escalate_case(
    case_id: uuid.UUID,
    body: EscalateBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Escalate a case from clinical_review to the md_review queue.

    Returns 200 with {'case_id': ..., 'queue': 'md_review'}.
    Returns 409 if the case is not in clinical_review or not found.
    """
    try:
        return await service.escalate(
            case_id, body.tenant_id, body.actor_id, body.actor_type.value, body.reason
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{case_id}/human-signoff", status_code=201, response_model=None)
async def record_human_signoff(
    case_id: uuid.UUID,
    body: SignoffBody,
    service: CaseService = Depends(_get_service),
) -> Any:
    """Record human clinician sign-off for an adverse determination.

    Returns 201 with the signoff row.
    This endpoint does NOT transition the case — use POST /cases/{id}/transitions
    with human_signoff_recorded=True after calling this endpoint.
    """
    return await service.record_signoff(
        case_id,
        body.tenant_id,
        body.actor_id,
        body.actor_type,
        body.outcome_context,
    )
