from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from enstellar_authz import AuthedRequest
from simintero_outbox import SchemaRef, make_envelope
from ..db.connection import get_pool
from simintero_tenant_context import tenant_transaction
from ..outbox.publisher import OutboxPublisher
from .repository import SuggestionsRepository

router = APIRouter(prefix="/cases", tags=["suggestions"])


class SuggestionActionBody(BaseModel):
    action: Literal["accepted", "rejected"]
    reviewer_id: str


@router.get("/{case_id}/suggestions", response_model=None)
async def get_suggestions(
    case_id: uuid.UUID,
    auth: AuthedRequest,
) -> Any:
    tenant_id = auth.tenant_id
    pool = await get_pool()
    repo = SuggestionsRepository()
    async with tenant_transaction(pool, tenant_id) as conn:
        return await repo.list_by_case(conn, case_id, tenant_id)


@router.post("/{case_id}/suggestions/{suggestion_id}/action", response_model=None)
async def suggestion_action(
    case_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    body: SuggestionActionBody,
    auth: AuthedRequest,
) -> Any:
    tenant_id = auth.tenant_id
    pool = await get_pool()
    repo = SuggestionsRepository()
    async with tenant_transaction(pool, tenant_id) as conn:
        found = await repo.record_action(
            conn,
            suggestion_id=suggestion_id,
            case_id=case_id,
            tenant_id=tenant_id,
            action=body.action,
            reviewer_id=body.reviewer_id,
        )
        if not found:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        await _emit_suggestion_reviewed_event(
            conn, case_id, suggestion_id, tenant_id, body.action, body.reviewer_id
        )
    return {"suggestion_id": str(suggestion_id), "status": body.action}


async def _emit_suggestion_reviewed_event(conn, case_id, suggestion_id, tenant_id, action, reviewer_id):
    """Emit agent.suggestion.reviewed provenance event via outbox."""
    publisher = OutboxPublisher()
    event = make_envelope(
        SchemaRef.AGENT_ASSIST_PRODUCED,
        tenant_id=tenant_id,
        actor_id=reviewer_id,
        actor_type="user",
        correlation_id=str(uuid.uuid4()),
        payload={
            "case_id": str(case_id),
            "suggestion_id": str(suggestion_id),
            "action": action,
            "reviewer_id": reviewer_id,
            "event_subtype": "agent.suggestion.reviewed",
        },
    )
    await publisher.publish(conn, event)
