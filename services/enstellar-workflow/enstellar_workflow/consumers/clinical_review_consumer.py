"""ClinicalReviewConsumer — submits a C-2 analysis to Revital on clinical_review entry.

On a CASE_STATE_TRANSITIONED event with to_state="clinical_review" this consumer
resolves the case's documents from the platform Document Service, submits a
completeness+triage analysis to the real Revital pipeline, and records a
revital_inflight row. A separate background poller picks up the result later.
It no longer calls the agent-layer.

INVARIANT #2: No LLM call on the decision path. Revital output is advisory only;
    this consumer never commits a determination.
INVARIANT #3: PHI minimized before the Revital boundary. case_context contains only
    procedure_codes, diagnosis_codes, urgency, and lob. Member name, DOB, MRN,
    address, NPI and coverage identifiers are NEVER included.
INVARIANT #4: Every DB row, event, and log line carries tenant_id.
NEVER-BLOCK: A Revital or Document Service failure must never block the case.
    On failure the consumer emits AGENT_ASSIST_FAILED and returns; the case
    continues to human-only review.
"""
from __future__ import annotations

import logging
import uuid

import asyncpg
import httpx

from canonical_model import Case, EventEnvelope
from simintero_outbox import SchemaRef, Topics, make_envelope

from simintero_tenant_context import tenant_transaction

from enstellar_connectors.revital.client import RevitalClient
from enstellar_connectors.revital.models import RevitalUnavailableError

from ..cases.repository import CaseRepository
from ..config import get_settings
from ..documents.client import DocumentServiceClient
from ..kafka.consumer import IdempotentKafkaConsumer
from ..outbox.publisher import OutboxPublisher
from ..revital import InflightRepository

logger = logging.getLogger(__name__)

_CLINICAL_REVIEW_STATE = "clinical_review"


def _lob(case: Case) -> str | None:
    from ..outbox.publisher import lob_for_envelope

    return lob_for_envelope(case.lob)


def _build_agent_input(case: Case, correlation_id: str) -> dict:
    """Build a PHI-minimized input dict; case_summary is reused as Revital case_context.

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
    """Listens for clinical_review state transitions and submits to Revital.

    On receiving a CASE_STATE_TRANSITIONED event with to_state="clinical_review":
      1. Resolves the case's document_refs from the Document Service (by case_ref).
      2. Submits a completeness+triage analysis to the Revital pipeline.
      3. Records a revital_inflight row for the background poller.

    The Revital output is advisory only and is never used to make or record a
    coverage determination. A Revital/doc failure never blocks the case.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__(
            pool,
            [Topics.CASE_LIFECYCLE],
            group_id="workflow-engine-clinical-review",
        )
        self._case_repo = CaseRepository()
        self._docs = DocumentServiceClient(get_settings().document_service_url)
        self._revital = RevitalClient()
        self._inflight = InflightRepository()
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

        async with tenant_transaction(self._pool, tenant_id) as conn:
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

        # Use the CASE's stable business correlation_id — NOT the event's
        # per-transition correlation_id. Documents were ingested (I2a) under the
        # case's stable id, and the Revital/inflight path must key on the same id.
        # The triggering event's id lives on as causation_id (lineage) below.
        correlation_id = case.correlation_id

        logger.info(
            "clinical_review_consumer_starting",
            extra={
                "tenant_id": case.tenant_id,
                "case_id": str(case.case_id),
                "correlation_id": correlation_id,
            },
        )

        # Carry the triggering event's id as causation_id so derived
        # AGENT_ASSIST_FAILED events record lineage.
        causation_id = event.event_id
        await self._submit_to_revital(case, correlation_id, causation_id)

    # ------------------------------------------------------------------
    # Revital submission
    # ------------------------------------------------------------------

    async def _submit_to_revital(
        self,
        case: Case,
        correlation_id: str,
        causation_id: str | None = None,
    ) -> None:
        """Resolve docs, submit to Revital, and record an in-flight row.

        INVARIANT #2: Revital output is advisory — never used for a determination.
        INVARIANT #3: case_context is the PHI-minimized case_summary.
        NEVER-BLOCK: any doc-resolve / submit failure emits AGENT_ASSIST_FAILED
            and returns — the case is never blocked.
        """
        tenant_id = case.tenant_id

        # 1. Idempotency: skip if an analysis is already processing for this case.
        async with tenant_transaction(self._pool, tenant_id) as conn:
            if await self._inflight.exists_processing_for_case(
                conn, case.case_id, tenant_id
            ):
                logger.info(
                    "revital_submit_skipped_duplicate",
                    extra={
                        "tenant_id": tenant_id,
                        "case_id": str(case.case_id),
                        "correlation_id": correlation_id,
                    },
                )
                return

        # 2. PHI-minimized case context (reuse the agent_input case_summary).
        case_context = _build_agent_input(case, correlation_id)["case_summary"]

        # 3. Resolve documents + submit. Any failure here must NEVER block the
        #    case: resolve_refs uses raw httpx (httpx.HTTPError) and submit raises
        #    RevitalUnavailableError. A broad Exception guard backs the never-block
        #    invariant against any other failure mode (e.g. malformed doc payload).
        try:
            refs = await self._docs.resolve_refs(
                case_ref=correlation_id, tenant_id=tenant_id
            )
            analysis_id = await self._revital.submit(
                case_ref=correlation_id,
                analysis_kinds=["completeness", "triage"],
                document_refs=refs,
                case_context=case_context,
                tenant_id=tenant_id,
            )
        except (RevitalUnavailableError, httpx.HTTPError) as exc:
            logger.error(
                "revital_submit_failed",
                extra={
                    "tenant_id": tenant_id,
                    "case_id": str(case.case_id),
                    "error": str(exc)[:400],
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case, "revital", str(exc), correlation_id, causation_id
            )
            return
        except Exception as exc:  # never-block: degrade any unexpected failure
            logger.error(
                "revital_submit_unexpected_error",
                extra={
                    "tenant_id": tenant_id,
                    "case_id": str(case.case_id),
                    "error": str(exc)[:400],
                    "correlation_id": correlation_id,
                },
            )
            await self._emit_failed_event(
                case, "revital", str(exc), correlation_id, causation_id
            )
            return

        # 4. Record the in-flight analysis for the background poller.
        async with tenant_transaction(self._pool, tenant_id) as conn:
            await self._inflight.insert(
                conn,
                analysis_id=analysis_id,
                case_id=case.case_id,
                tenant_id=tenant_id,
                correlation_id=correlation_id,
            )

        logger.info(
            "revital_submitted",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(case.case_id),
                "analysis_id": analysis_id,
                "document_count": len(refs),
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
        async with tenant_transaction(self._pool, case.tenant_id) as conn:
            await self._outbox.publish(conn, event)
            await conn.execute(
                "UPDATE workflow_instances SET revital_bypassed = TRUE WHERE case_id = $1",
                case.case_id,
            )
