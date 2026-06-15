"""Async httpx client wrapping the workflow-engine REST API."""
from __future__ import annotations

import httpx

from enstellar_bff.config import settings


class WorkflowClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=settings.workflow_engine_url,
            timeout=10.0,
        )

    def _auth(self, bearer_token: str) -> dict[str, str]:
        # bearer_token is the raw JWT forwarded from the request; normalise to a
        # full Authorization header value (idempotent if already prefixed).
        value = (
            bearer_token
            if bearer_token.lower().startswith("bearer ")
            else f"Bearer {bearer_token}"
        )
        return {"Authorization": value}

    async def get_case(self, case_id: str, bearer_token: str) -> dict:
        r = await self._http.get(
            f"/cases/{case_id}",
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def get_worklist(
        self,
        bearer_token: str,
        queue_id: str,
        page: int,
        page_size: int,
    ) -> dict:
        r = await self._http.get(
            f"/queues/{queue_id}/worklist",
            params={"page": page, "page_size": page_size},
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def transition(
        self,
        case_id: str,
        tenant_id: str,
        to_state: str,
        actor_id: str,
        actor_type: str,
        correlation_id: str,
        payload: dict,
        human_signoff_recorded: bool = False,
    ) -> dict:
        r = await self._http.post(
            f"/cases/{case_id}/transitions",
            json={
                "tenant_id": tenant_id,
                "to_state": to_state,
                "actor_id": actor_id,
                "actor_type": actor_type,
                "correlation_id": correlation_id,
                "payload": payload,
                "human_signoff_recorded": human_signoff_recorded,
            },
        )
        r.raise_for_status()
        return r.json()

    async def record_signoff(
        self,
        case_id: str,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """POST /cases/{case_id}/human-signoff on the workflow-engine."""
        r = await self._http.post(
            f"/cases/{case_id}/human-signoff",
            json={
                "tenant_id": tenant_id,
                "actor_id": actor_id,
                "actor_type": actor_type,
                "outcome_context": outcome_context,
            },
        )
        r.raise_for_status()
        return r.json()

    async def queue_stats(self, queue_id: str, bearer_token: str) -> dict:
        """GET /queues/{queue_id}/stats — rolling 30-day governance aggregates."""
        r = await self._http.get(
            f"/queues/{queue_id}/stats",
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def rfi(
        self,
        case_id: str,
        bearer_token: str,
        provider_npi: str,
        document_types: list[str],
        free_text: str | None,
        actor_id: str,
    ) -> dict:
        """POST /cases/{case_id}/pend-rfi on the workflow-engine.

        Invariant: provider_npi is sourced from the case by the BFF caller —
        it must never be accepted from the reviewer's request body.
        Invariant: actor_id is sourced from auth["sub"] by the BFF caller —
        it must never be accepted from the reviewer's request body.
        """
        r = await self._http.post(
            f"/cases/{case_id}/pend-rfi",
            json={
                "provider_npi": provider_npi,
                "document_types": document_types,
                "free_text": free_text,
                "actor_id": actor_id,
            },
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def criteria(self, case_id: str, bearer_token: str) -> list[dict]:
        r = await self._http.get(
            f"/cases/{case_id}/criteria",
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def suggestions(self, case_id: str, bearer_token: str) -> list[dict]:
        r = await self._http.get(
            f"/cases/{case_id}/suggestions",
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()

    async def suggestion_action(
        self,
        case_id: str,
        suggestion_id: str,
        bearer_token: str,
        action: str,
        reviewer_id: str,
    ) -> dict:
        r = await self._http.post(
            f"/cases/{case_id}/suggestions/{suggestion_id}/action",
            json={"action": action, "reviewer_id": reviewer_id},
            headers=self._auth(bearer_token),
        )
        r.raise_for_status()
        return r.json()


workflow_client = WorkflowClient()
