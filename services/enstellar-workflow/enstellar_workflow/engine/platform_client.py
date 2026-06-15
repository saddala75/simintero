"""HTTP client for notifying the platform case service of state transitions.

Used by TransitionEngine after its own writes complete.
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

import httpx

from simintero_outbox import map_actor_type

if TYPE_CHECKING:
    from .transitions import TransitionRequest

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 5.0


class PlatformCaseClient:
    """Thin wrapper around the platform POST /internal/transitions/notify endpoint."""

    def __init__(self, base_url: str, timeout: float = _DEFAULT_TIMEOUT) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def post_transition(
        self,
        *,
        req: "TransitionRequest",
        from_state: str,
        event_id: uuid.UUID,
    ) -> None:
        """POST a CaseStateChanged envelope to the platform case service.

        Raises httpx.HTTPStatusError on 4xx/5xx.
        Raises httpx.ConnectError on network failure.
        The caller decides whether to swallow or propagate.
        """
        envelope = {
            "event_id": str(event_id),
            "schema_ref": "sim.case.lifecycle/CaseStateChanged/v1",
            "occurred_at": None,
            "tenant": {"tenant_id": req.tenant_id},
            "correlation_id": req.correlation_id,
            "causation_id": None,
            "actor": {"type": map_actor_type(req.actor_type), "id": req.actor_id},
            "trace_ref": None,
            "payload": {
                "case_id": str(req.case_id),
                "from": from_state,
                "to": req.to_state,
                "trigger": req.payload.get("trigger", ""),
                "human_signoff_recorded": req.human_signoff_recorded,
            },
        }
        url = f"{self._base_url}/internal/transitions/notify"
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                url,
                json=envelope,
                headers={"x-sim-tenant-id": req.tenant_id},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            logger.debug(
                "platform notified: case=%s %s→%s",
                req.case_id,
                from_state,
                req.to_state,
            )
