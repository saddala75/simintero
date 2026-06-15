"""ClinicalReviewConsumer — triggers Completeness and Triage agents on clinical_review entry.

INVARIANT #2: No LLM call on the decision path. This consumer invokes the agent-layer
    via HTTP and writes advisory suggestions/criteria only. It never commits a determination.
INVARIANT #3: PHI minimized before every agent call. case_summary contains only
    procedure_codes, diagnosis_codes, urgency, and lob. Member name, DOB, MRN,
    address, NPI and coverage identifiers are NEVER included.
INVARIANT #4: Every DB row, event, and log line carries tenant_id.
INVARIANT #5 (abstained): When agent output has abstained=True, NO criteria or
    suggestion rows are written. Only a WARN log and AGENT_ASSIST_FAILED outbox event.
"""
from __future__ import annotations

import logging
import uuid

import asyncpg
import httpx

from canonical_model import Case, EventEnvelope
from simintero_outbox import SchemaRef, Topics, make_envelope

from ..cases.repository import CaseRepository
from ..config import get_settings
from ..criteria.repository import CriteriaRepository
from ..kafka.consumer import IdempotentKafkaConsumer
from ..outbox.publisher import OutboxPublisher
from ..suggestions.repository import SuggestionsRepository

logger = logging.getLogger(__name__)

_CLINICAL_REVIEW_STATE = "clinical_review"


def _lob(case: Case) -> str | None:
    from ..outbox.publisher import lob_for_envelope

    return lob_for_envelope(case.lob)


def _build_agent_input(case: Case, correlation_id: str) -> dict:
    """Build a PHI-minimized agent input dict for agent-layer HTTP calls.

    INVARIANT #3 enforcement: member first_name, last_name, date_of_birth, mrn,
    coverage subscriber_id, plan_id, requesting_provider NPI are all EXCLUDED.
    Only codes, urgency, and lob pass the boundary.
    """
    procedure_codes = [sl.procedure_code for sl in case.service_lines]
    # Deduplicate while preserving order via dict key insertion.
    diagnosis_codes = list(
        dict.fromkeys(
            code
            for sl in case.service_lines
            for code in sl.diagnosis_codes
        )
    )
    return {
        "tenant_id": case.tenant_id,
        "case_id": str(case.case_id),
        "case_summary": {
            "procedure_codes": procedure_codes,
            "diagnosis_codes": diagnosis_codes,
            "urgency": case.urgency.value,
            "lob": case.lob,
        },
        "doc_requirements": [],
        "correlation_id": correlation_id,
    }


class ClinicalReviewConsumer(IdempotentKafkaConsumer):
    """Listens for clinical_review state transitions and runs advisory agents.

    On receiving a CASE_STATE_TRANSITIONED event with to_state="clinical_review":
      1. Calls /assist/completeness → writes criteria gaps (advisory).
      2. Calls /assist/triage → writes one routing suggestion (advisory).

    Neither agent output is used to make or record a coverage determination.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(
            pool,
            [Topics.CASE_LIFECYCLE],
            group_id="workflow-engine-clinical-review",
        )
        self._case_repo = CaseRepository()
        self._criteria_repo = CriteriaRepository()
        self._suggestions_repo = SuggestionsRepository()
        self._outbox = OutboxPublisher()

    # ------------------------------------------------------------------
    # Handle
    # ------------------------------------------------------------------

    async def handle(self, event: EventEnvelope) -> None:  # type: ignore[override]
        """Process one CASE_STATE_TRANSITIONED event.

        Only reacts to to_state == 'clinical_review'. All other transitions
        are ignored — this consumer does not own them.
        """
        to_state = (event.payload or {}).get("to_state", "")
        if to_state != _CLINICAL_REVIEW_STATE:
            return

        tenant_id = event.tenant.tenant_id
        case_id_raw = (event.payload or {}).get("case_id")
        if case_id_raw is None:
            logger.error(
                "clinical_review_consumer_missing_case_id",
                extra={
                    "tenant_id": tenant_id,
                    "event_id": event.event_id,
                    "correlation_id": event.correlation_id,
                },
            )
            return
        case_id = uuid.UUID(str(case_id_raw))

        async with self._pool.acquire() as conn:
            case = await self._case_repo.fetch_by_id(conn, case_id, tenant_id)

        if case is None:
            logger.error(
                "clinical_review_consumer_case_not_found",
                extra={
                    "tenant_id": tenant_id,
                    "case_id": str(case_id),
                    "event_id": event.event_id,
                },
            )
            return

        correlation_id = event.correlation_id
        agent_input = _build_agent_input(case, correlation_id)

        logger.info(
            "clinical_review_consumer_starting",
            extra={
                "tenant_id": case.tenant_id,
                "case_id": str(case.case_id),
                "correlation_id": correlation_id,
            },
        )

        # Carry the triggering event's id as causation_id so derived
        # AGENT_ASSIST_PRODUCED / AGENT_ASSIST_FAILED events record lineage.
        causation_id = event.event_id
        await self._run_completeness(case, agent_input, correlation_id, causation_id)
        await self._run_triage(case, agent_input, correlation_id, causation_id)

    # ------------------------------------------------------------------
    # Completeness agent
    # ------------------------------------------------------------------

    async def _run_completeness(
        self,
        case: Case,
        agent_input: dict,
        correlation_id: str,
        causation_id: str | None = None,
    ) -> None:
        """POST to /assist/completeness and write criteria gap rows.

        INVARIANT #2: output is advisory — never used for a determination.
        INVARIANT #5: abstained=True → no rows, only AGENT_ASSIST_FAILED event.
        """
        settings = get_settings()
        url = f"{settings.agent_layer_url}/assist/completeness"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=agent_input)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error(
                "completeness_agent_http_error",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "error": str(exc)[:400],
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case, "completeness-v1", str(exc), correlation_id, causation_id
            )
            return

        output = resp.json()

        if output.get("abstained") is True:
            logger.warning(
                "completeness_agent_abstained",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "abstention_reason": output.get("abstention_reason"),
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case,
                output.get("agent_id", "completeness-v1"),
                output.get("abstention_reason") or "abstained",
                correlation_id,
                causation_id,
            )
            return

        result = output.get("result") or {}
        gaps = result.get("gaps", [])
        rows = [
            {
                "case_id": case.case_id,
                "tenant_id": case.tenant_id,
                "criterion_id": gap["required_document_type"],
                "text": gap["description"],
                "status": "gap",
                "citations": [gap["citation"]] if gap.get("citation") else [],
            }
            for gap in gaps
        ]

        provenance = output.get("provenance") or {}
        event = make_envelope(
            SchemaRef.AGENT_ASSIST_PRODUCED,
            tenant_id=case.tenant_id,
            actor_id=output.get("agent_id", "completeness-v1"),
            actor_type="service",
            correlation_id=correlation_id,
            causation_id=causation_id,
            lob=_lob(case),
            payload={
                "case_id": str(case.case_id),
                "agent_id": output.get("agent_id", "completeness-v1"),
                "confidence": output.get("confidence"),
                "citations": output.get("citations", []),
                **provenance,
            },
        )

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                if rows:
                    await self._criteria_repo.insert_many(conn, rows)
                await self._outbox.publish(conn, event)

        logger.info(
            "completeness_agent_done",
            extra={
                "tenant_id": case.tenant_id,
                "case_id": str(case.case_id),
                "gaps_written": len(rows),
                "correlation_id": correlation_id,
            },
        )

    # ------------------------------------------------------------------
    # Triage agent
    # ------------------------------------------------------------------

    async def _run_triage(
        self,
        case: Case,
        agent_input: dict,
        correlation_id: str,
        causation_id: str | None = None,
    ) -> None:
        """POST to /assist/triage and write one routing suggestion row.

        INVARIANT #2: output is advisory — never used for a determination.
        INVARIANT #5: abstained=True → no rows, only AGENT_ASSIST_FAILED event.
        """
        settings = get_settings()
        url = f"{settings.agent_layer_url}/assist/triage"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=agent_input)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error(
                "triage_agent_http_error",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "error": str(exc)[:400],
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case, "triage-v1", str(exc), correlation_id, causation_id
            )
            return

        output = resp.json()

        if output.get("abstained") is True:
            logger.warning(
                "triage_agent_abstained",
                extra={
                    "tenant_id": case.tenant_id,
                    "case_id": str(case.case_id),
                    "abstention_reason": output.get("abstention_reason"),
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case,
                output.get("agent_id", "triage-v1"),
                output.get("abstention_reason") or "abstained",
                correlation_id,
                causation_id,
            )
            return

        result = output.get("result") or {}
        row = {
            "case_id": case.case_id,
            "tenant_id": case.tenant_id,
            "agent_id": output.get("agent_id", "triage-v1"),
            "title": f"Suggested queue: {result.get('suggested_queue', 'unknown')}",
            "body": result.get("rationale", ""),
            "confidence": float(output.get("confidence", 0.0)),
            "citations": output.get("citations", []),
        }

        provenance = output.get("provenance") or {}
        event = make_envelope(
            SchemaRef.AGENT_ASSIST_PRODUCED,
            tenant_id=case.tenant_id,
            actor_id=output.get("agent_id", "triage-v1"),
            actor_type="service",
            correlation_id=correlation_id,
            causation_id=causation_id,
            lob=_lob(case),
            payload={
                "case_id": str(case.case_id),
                "agent_id": output.get("agent_id", "triage-v1"),
                "confidence": output.get("confidence"),
                "citations": output.get("citations", []),
                **provenance,
            },
        )

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._suggestions_repo.insert_many(conn, [row])
                await self._outbox.publish(conn, event)

        logger.info(
            "triage_agent_done",
            extra={
                "tenant_id": case.tenant_id,
                "case_id": str(case.case_id),
                "suggested_queue": result.get("suggested_queue"),
                "correlation_id": correlation_id,
            },
        )

    # ------------------------------------------------------------------
    # Failure event helper
    # ------------------------------------------------------------------

    async def _emit_failed_event(
        self,
        case: Case,
        agent_id: str,
        reason: str,
        correlation_id: str,
        causation_id: str | None = None,
    ) -> None:
        """Write an AGENT_ASSIST_FAILED outbox event in its own transaction."""
        event = make_envelope(
            SchemaRef.AGENT_ASSIST_FAILED,
            tenant_id=case.tenant_id,
            actor_id=agent_id,
            actor_type="service",
            correlation_id=correlation_id,
            causation_id=causation_id,
            lob=_lob(case),
            payload={
                "case_id": str(case.case_id),
                "agent_id": agent_id,
                "reason": reason,
            },
        )
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._outbox.publish(conn, event)
