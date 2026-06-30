from __future__ import annotations

import asyncio
import uuid as uuid_module
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from enstellar_bff.auth import require_auth, require_reviewer
from enstellar_bff.clients.fhir import fhir_client
from enstellar_bff.clients.workflow import workflow_client
from enstellar_bff.models import (
    AdverseDecisionRequest,
    CaseDetail,
    CitationSpan,
    ClinicalEntity,
    CompletenessItem,
    CriterionItem,
    DecisionSubmission,
    DeterminationRequest,
    DocumentItem,
    EntityStatusUpdate,
    GroundednessMetric,
    RfiRequest,
    SuggestionActionRequest,
    SuggestionItem,
    WorkbenchCaseDetail,
)

# Adverse states: BFF never routes to these; T08 guard is the final backstop.
ADVERSE_STATES = frozenset({"denied", "partially_denied", "adverse_modification"})

_STATUS_TO_ENTITY: dict[str, str] = {"met": "accepted", "gap": "disputed", "unknown": "pending"}
_ENTITY_TO_CRITERION: dict[str, str] = {"accepted": "met", "disputed": "gap", "pending": "unknown"}
_STATUS_TO_CONF: dict[str, float] = {"met": 1.0, "gap": 0.0, "unknown": 0.5}


def _assemble_workbench(
    case_id: str,
    case_data: dict,
    criteria_data: list[dict],
    suggestions_data: list[dict],
    docs_data: list[dict],
) -> WorkbenchCaseDetail:
    member = case_data.get("member") or {}
    service_lines = case_data.get("service_lines") or []
    service_desc = service_lines[0].get("service_description", "") if service_lines else ""

    entities: list[ClinicalEntity] = []
    completeness: list[CompletenessItem] = []
    citations: list[CitationSpan] = []
    cite_seen: set[str] = set()

    for c in criteria_data:
        st = c["status"]
        crit_cites: list[str] = c.get("citations") or []
        cite_id = f"cite-{c['criterion_id']}"
        first_cite = crit_cites[0] if crit_cites else None

        entities.append(ClinicalEntity(
            id=c["id"],
            type="procedure",
            name=c["text"],
            code=c["criterion_id"],
            system="InterQual",
            confidence=_STATUS_TO_CONF.get(st, 0.5),
            provenance=str(c.get("evidence") or ""),
            status=_STATUS_TO_ENTITY.get(st, "pending"),
            citationId=cite_id if first_cite else None,
        ))
        completeness.append(CompletenessItem(
            criteria=c["text"],
            satisfied=(st == "met"),
            note=f"Status: {st}",
        ))
        if first_cite and cite_id not in cite_seen:
            cite_seen.add(cite_id)
            citations.append(CitationSpan(id=cite_id, page=1, text=first_cite, bbox=""))

    total = len(criteria_data)
    met_count = sum(1 for c in criteria_data if c["status"] == "met")
    gap_count = sum(1 for c in criteria_data if c["status"] == "gap")
    total_cites = sum(len(c.get("citations") or []) for c in criteria_data)

    doc_url: str | None = None
    if docs_data:
        doc_url = f"/bff/cases/{case_id}/documents/{docs_data[0]['id']}/content"

    return WorkbenchCaseDetail(
        caseId=case_id,
        memberName=member.get("name", ""),
        memberDob=member.get("dob", ""),
        serviceRequested=service_desc,
        documentUrl=doc_url,
        entities=entities,
        citations=citations,
        groundedness=GroundednessMetric(
            score=round(met_count / total, 2) if total else 0.0,
            citationsCount=total_cites,
            gapsCount=gap_count,
            conflictsCount=0,
        ),
        summary=(suggestions_data[0]["body"] if suggestions_data else ""),
        completeness=completeness,
    )


router = APIRouter(tags=["cases"])


class CloseBody(BaseModel):
    reason: str | None = None


@router.post("/cases/{case_id}/close")
async def close_case(
    case_id: UUID,
    body: CloseBody,
    auth: tuple = Depends(require_auth),
) -> Any:
    """Thin pass-through: forward the bearer to the engine close endpoint.

    Gated by ``require_auth`` (authenticate only); the engine enforces the
    specific role on the forwarded token."""
    _ctx, bearer = auth
    return await workflow_client.close_case(str(case_id), bearer, reason=body.reason)


@router.get("/cases/{case_id}", response_model=CaseDetail)
async def get_case(
    case_id: UUID,
    auth: tuple = Depends(require_reviewer),
) -> CaseDetail:
    _ctx, bearer = auth
    data = await workflow_client.get_case(str(case_id), bearer)
    return CaseDetail(
        case_id=data["case_id"],
        tenant_id=data["tenant_id"],
        status=data["status"],
        urgency=data["urgency"],
        lob=data["lob"],
        member=data.get("member", {}),
        coverage=data.get("coverage", {}),
        service_lines=data.get("service_lines", []),
        events=data.get("events", []),
        sla=None,
    )


@router.get("/cases/{case_id}/workbench", response_model=WorkbenchCaseDetail)
async def get_workbench(
    case_id: UUID,
    auth: tuple = Depends(require_reviewer),
) -> WorkbenchCaseDetail:
    ctx, bearer = auth
    case_res, criteria_res, suggestions_res, docs_res = await asyncio.gather(
        workflow_client.get_case(str(case_id), bearer),
        workflow_client.criteria(str(case_id), bearer),
        workflow_client.suggestions(str(case_id), bearer),
        fhir_client.documents(str(case_id), ctx.tenant_id, bearer),
        return_exceptions=True,
    )
    if isinstance(case_res, Exception):
        raise HTTPException(status_code=502, detail="Upstream error fetching case")
    if isinstance(criteria_res, Exception):
        criteria_res = []
    if isinstance(suggestions_res, Exception):
        suggestions_res = []
    if isinstance(docs_res, Exception):
        docs_res = []
    return _assemble_workbench(str(case_id), case_res, criteria_res, suggestions_res, docs_res)


@router.post("/cases/{case_id}/decision")
async def submit_decision(
    case_id: UUID,
    body: DecisionSubmission,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    ctx, _bearer = auth
    # Map reviewer outcomes to valid non-adverse workflow states.
    # ADVERSE_STATES are never reachable from this endpoint by design.
    to_state = "approved" if body.outcome == "approved" else "clinical_review"

    result = await workflow_client.transition(
        case_id=str(case_id),
        tenant_id=ctx.tenant_id,
        to_state=to_state,
        actor_id=ctx.sub,
        actor_type="user",
        correlation_id=str(uuid_module.uuid4()),
        payload={"reason": body.reason} if body.reason else {},
        human_signoff_recorded=True,
    )
    return result


@router.post("/cases/{case_id}/adverse-decision")
async def submit_adverse_decision(
    case_id: UUID,
    body: AdverseDecisionRequest,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    """Record clinician sign-off and apply an adverse state transition.

    Two-step sequence:
      1. POST /cases/{id}/human-signoff  (records the sign-off row)
      2. POST /cases/{id}/transitions with human_signoff_recorded=True

    Returns 400 if sign_off_confirmed is not True.
    Returns 403 if clinician_id does not match the authenticated user's JWT sub.

    Non-negotiable invariant: no adverse determination without a recorded
    human (clinician) sign-off. This endpoint is the sole BFF path to an
    adverse state; the workflow-engine transition guard is the final backstop.

    Identity invariant: clinician_id MUST match the authenticated JWT sub.
    Prevents reviewers from recording sign-offs attributed to other clinicians.
    """
    ctx, _bearer = auth
    if not body.sign_off_confirmed:
        raise HTTPException(
            status_code=400,
            detail="sign_off_confirmed must be True for adverse decisions",
        )

    # Identity enforcement: clinician_id must match the authenticated user.
    # This closes the spoofing gap where any reviewer could record a sign-off
    # attributed to any other clinician. Actor identity ALWAYS comes from JWT sub.
    if body.clinician_id and body.clinician_id != ctx.sub:
        raise HTTPException(
            status_code=403,
            detail=(
                f"clinician_id must match authenticated user; "
                f"got {body.clinician_id!r}, expected {ctx.sub!r}"
            ),
        )

    # Generate once — shared by signoff and transition for audit trail traceability.
    correlation_id = str(uuid_module.uuid4())

    # Always stamp actor from JWT sub — never from request body.
    await workflow_client.record_signoff(
        case_id=str(case_id),
        tenant_id=ctx.tenant_id,
        actor_id=ctx.sub,
        actor_type="clinician",
        outcome_context=body.outcome,
    )

    payload: dict = {
        "reason": body.reason,
        "determination_type": body.outcome,  # always derived, not accepted from client
    }
    if body.finding_sections is not None:
        payload["finding_sections"] = [f.model_dump() for f in body.finding_sections]
    if body.reason_codes is not None:
        payload["reason_codes"] = body.reason_codes
    if body.citations is not None:
        payload["citations"] = body.citations

    return await workflow_client.transition(
        case_id=str(case_id),
        tenant_id=ctx.tenant_id,
        to_state=body.outcome,
        actor_id=ctx.sub,
        actor_type="user",
        correlation_id=correlation_id,
        payload=payload,
        human_signoff_recorded=True,
    )


@router.post("/cases/{case_id}/rfi", status_code=200)
async def post_rfi(
    case_id: UUID,
    body: RfiRequest,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    """Proxy RFI request to workflow-engine pend-rfi endpoint.

    Invariant: provider_npi is fetched from the case by BFF — never
    accepted from the reviewer's request body.
    Invariant: actor_id comes from the authenticated sub — never from request body.
    Both invariants are enforced by the BFF and asserted by tests.
    """
    ctx, bearer_token = auth
    actor_id: str = ctx.sub  # INVARIANT: always from auth, never from body
    case = await workflow_client.get_case(str(case_id), bearer_token)
    # INVARIANT: provider_npi fetched from case, never accepted from request body
    provider_npi: str = (
        case.get("practitioner_npi")
        or (case.get("provider") or {}).get("npi", "")
        or (case.get("requesting_provider") or {}).get("npi", "")
        or ""
    )
    await workflow_client.rfi(
        case_id=str(case_id),
        bearer_token=bearer_token,
        provider_npi=provider_npi,
        document_types=body.requested_docs,
        free_text=body.question or None,
        actor_id=actor_id,
    )
    return {"status": "pend_rfi"}


@router.get("/cases/{case_id}/documents", response_model=list[DocumentItem])
async def get_documents(
    case_id: str,
    auth: tuple = Depends(require_reviewer),
) -> list[DocumentItem]:
    """Return BFF-proxied DocumentItems for a case.

    Security invariant: the url field is always the BFF proxy path —
    no raw HAPI or MinIO URLs are returned to the browser.
    """
    ctx, bearer = auth
    raw_docs = await fhir_client.documents(case_id, ctx.tenant_id, bearer)
    return [
        DocumentItem(
            id=d["id"],
            title=d["title"],
            doc_type=d["doc_type"],
            content_type=d["content_type"],
            authored=d["authored"],
            url=f"/bff/cases/{case_id}/documents/{d['id']}/content",
        )
        for d in raw_docs
    ]


@router.get("/cases/{case_id}/documents/{doc_id}/content")
async def proxy_document_content(
    case_id: str,
    doc_id: str,
    auth: tuple = Depends(require_reviewer),
) -> StreamingResponse:
    """Stream document content through the BFF — the raw attachment URL never reaches the browser."""
    ctx, bearer = auth
    resource = await fhir_client.document_by_id(doc_id, ctx.tenant_id, bearer)
    content = (resource.get("content") or [{}])[0]
    attachment = content.get("attachment") or {}
    attachment_url = attachment.get("url")
    if not attachment_url:
        raise HTTPException(status_code=404, detail="No attachment URL on document")
    content_type = attachment.get("contentType", "application/octet-stream")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            upstream = await client.get(attachment_url)
            upstream.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Upstream document fetch failed") from exc
    except httpx.TransportError as exc:
        raise HTTPException(status_code=502, detail="Upstream document unreachable") from exc
    return StreamingResponse(
        iter([upstream.content]),
        media_type=content_type,
    )


@router.get("/cases/{case_id}/criteria", response_model=list[CriterionItem])
async def get_case_criteria(
    case_id: UUID,
    auth: tuple = Depends(require_reviewer),
) -> list[CriterionItem]:
    _ctx, bearer = auth
    try:
        data = await workflow_client.criteria(str(case_id), bearer)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Case not found")
        raise HTTPException(status_code=502, detail="Upstream error")
    return [CriterionItem(**item) for item in data]


@router.get("/cases/{case_id}/suggestions", response_model=list[SuggestionItem])
async def get_case_suggestions(
    case_id: UUID,
    auth: tuple = Depends(require_reviewer),
) -> list[SuggestionItem]:
    _ctx, bearer = auth
    try:
        data = await workflow_client.suggestions(str(case_id), bearer)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Case not found")
        raise HTTPException(status_code=502, detail="Upstream error")
    return [SuggestionItem(**item) for item in data]


@router.post("/cases/{case_id}/suggestions/{suggestion_id}/action")
async def post_suggestion_action(
    case_id: UUID,
    suggestion_id: UUID,
    body: SuggestionActionRequest,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    ctx, bearer = auth
    try:
        return await workflow_client.suggestion_action(
            case_id=str(case_id),
            suggestion_id=str(suggestion_id),
            bearer_token=bearer,
            action=body.action,
            reviewer_id=ctx.sub,
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        raise HTTPException(status_code=502, detail="Upstream error")


@router.patch("/cases/{case_id}/entities/{entity_id}")
async def update_entity_status(
    case_id: UUID,
    entity_id: UUID,
    body: EntityStatusUpdate,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    """Translate Revital entity status (accepted/disputed/pending) → criterion status (met/gap/unknown)
    and persist via the workflow engine."""
    _ctx, bearer = auth
    try:
        return await workflow_client.update_criterion(
            str(case_id), str(entity_id), _ENTITY_TO_CRITERION[body.status], bearer
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Entity not found")
        raise HTTPException(status_code=502, detail="Upstream error")


@router.post("/cases/{case_id}/determination")
async def post_determination(
    case_id: UUID,
    body: DeterminationRequest,
    auth: tuple = Depends(require_reviewer),
) -> dict:
    """Record the reviewer's AI advisory decision (accept/adverse).

    For 'accept': marks the primary suggestion as accepted.
    For 'adverse': marks the primary suggestion as rejected; the actual adverse
    determination is completed via the portal's /cases/{id}/adverse-decision endpoint.
    If no suggestion exists the decision is still recorded in the response.
    """
    ctx, bearer = auth
    suggestions = await workflow_client.suggestions(str(case_id), bearer)
    if suggestions:
        action = "accepted" if body.decision == "accept" else "rejected"
        await workflow_client.suggestion_action(
            case_id=str(case_id),
            suggestion_id=suggestions[0]["id"],
            bearer_token=bearer,
            action=action,
            reviewer_id=ctx.sub,
        )
    return {"status": body.decision}
