"""AutoDeterminator — approve-only auto-determination path.

INVARIANT #1 (NON-NEGOTIABLE):
  This class can only produce Status.approved or Status.clinical_review.
  It is structurally impossible for it to produce denied, partially_denied,
  or adverse_modification. See _approve() and _route_to_clinical_review():
  the only two to_state values ever passed to TransitionEngine.apply() are
  "approved" and "clinical_review".

INVARIANT #2 (DETERMINISTIC DECISION PATH):
  No AI/inference call participates here. The only decision source is
  the deterministic Digicore rule engine.

INVARIANT #5:
  tenant_id flows through every DecisionRequest, TransitionRequest, and
  EventEnvelope created here.

Decision path sensitivity: changes to this file require senior engineer review.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import asyncpg

from canonical_model.case import Case, Status
from canonical_model.decision import Decision, Outcome
from enstellar_connectors import CircuitOpenError
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_connectors.digicore.models import DecisionRequest, DecisionResponse
from simintero_outbox import SchemaRef, make_envelope

from ..outbox.publisher import OutboxPublisher, lob_for_envelope
from .decision_recorder import DecisionRecorder
from .transitions import TransitionEngine, TransitionRequest

logger = logging.getLogger(__name__)

_ACTOR_ID = "auto-determination"
_ACTOR_TYPE = "system"


class AutoDeterminator:
    """Approve-only auto-determination path.

    INVARIANT: The only to_state values ever passed to engine.apply() are
    "approved" and "clinical_review". The class is deliberately structured
    so that there is no code path to an adverse state:

    * _approve()                  → to_state = "approved"
    * _route_to_clinical_review() → to_state = "clinical_review"
    * All Digicore exceptions     → _route_to_clinical_review()

    The adverse-transition guard in guards.py provides a second defense
    layer; it would reject any attempt to pass an adverse to_state.
    """

    def __init__(
        self,
        engine: TransitionEngine,
        digicore: DigiCoreClient,
    ) -> None:
        self._engine = engine
        self._digicore = digicore
        self._decision_recorder = DecisionRecorder()
        self._publisher = OutboxPublisher()

    async def run(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
    ) -> Case:
        """Run auto-determination for one case. Returns the updated case.

        Outcome routing (exhaustive — no other branches exist):
          Digicore returns "approved"       → _approve()
          Digicore returns "pending_review" → _route_to_clinical_review(reason="pending_review")
          Digicore returns "denied"         → _route_to_clinical_review(reason="denied")
          CircuitOpenError                  → _route_to_clinical_review(reason="digicore_unavailable")
          Any other exception               → _route_to_clinical_review(reason="digicore_unavailable")

        The caller must be inside a transaction. Both _approve() and
        _route_to_clinical_review() call engine.apply() which writes to
        workflow_instances, workflow_events, and outbox — all within the
        caller's transaction.
        """
        req = DecisionRequest(
            case_id=str(case.case_id),
            service_code=case.service_lines[0].procedure_code,
            member_id=str(case.member.member_id),
            plan_id=case.coverage.plan_id,
            tenant_id=case.tenant_id,
        )

        try:
            resp: DecisionResponse = await self._digicore.evaluate_request(req)
        except Exception as exc:
            # Digicore unavailable or circuit open — route to human review.
            # Never block the case; never raise here.
            logger.warning(
                "digicore_unavailable case_id=%s tenant_id=%s error=%s",
                case.case_id,
                case.tenant_id,
                type(exc).__name__,
            )
            return await self._route_to_clinical_review(
                conn, case, correlation_id, reason="digicore_unavailable"
            )

        if resp.decision == "approved":
            return await self._approve(conn, case, correlation_id, resp)

        # 'pending_review' or 'denied' from Digicore → clinical review.
        # INVARIANT: 'denied' from Digicore does NOT map to Status.denied here.
        # A human reviewer must make any adverse determination.
        logger.info(
            "digicore_non_approved case_id=%s tenant_id=%s decision=%s → clinical_review",
            case.case_id,
            case.tenant_id,
            resp.decision,
        )
        return await self._route_to_clinical_review(
            conn, case, correlation_id, reason=resp.decision
        )

    async def _approve(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
        resp: DecisionResponse,
    ) -> Case:
        """Apply an auto-approval: transition to 'approved' + record Decision + emit event."""
        decided_at = datetime.now(timezone.utc)

        decision = Decision(
            decision_id=uuid.uuid4(),
            tenant_id=case.tenant_id,
            case_id=case.case_id,
            outcome=Outcome.approved,
            decided_by="auto",
            rule_artifact_id=resp.structured_trace.artifact,
            rule_version=resp.structured_trace.version,
            criteria_branch=resp.structured_trace.logic_branch,
            evidence_refs=[resp.structured_trace.source],
            human_signoff_required=False,
            human_signoff_actor=None,
            human_signoff_at=None,
            auto_approved=True,
            decided_at=decided_at,
            pins=[p.model_dump() for p in resp.pins] if resp.pins else None,
        )

        # 1. Transition the case state to 'approved'.
        #    human_signoff_recorded=False is correct: the adverse-transition guard
        #    only blocks transitions to adverse states; 'approved' is not adverse.
        transition_req = TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state=Status.approved,
            actor_id=_ACTOR_ID,
            actor_type=_ACTOR_TYPE,
            correlation_id=correlation_id,
            payload={"decision": decision.model_dump(mode="json")},
            human_signoff_recorded=False,
        )
        updated_case, transition_event_id = await self._engine.apply(conn, transition_req)

        # 2. Append the Decision to case_json.decisions (same transaction).
        await self._decision_recorder.append_decision(
            conn,
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            decision=decision,
        )

        # 3. Emit decision.recorded event to the outbox (same transaction).
        event = make_envelope(
            SchemaRef.DECISION_RECORDED,
            tenant_id=case.tenant_id,
            actor_id=_ACTOR_ID,
            actor_type=_ACTOR_TYPE,
            correlation_id=correlation_id,
            occurred_at=decided_at,
            lob=lob_for_envelope(case.lob),
            causation_id=str(transition_event_id),
            payload={
                "case_id": str(case.case_id),
                "decision_id": str(decision.decision_id),
                "outcome": decision.outcome.value,
                "decided_by": decision.decided_by,
                "auto_approved": True,
                "rule_artifact_id": decision.rule_artifact_id,
                "rule_version": decision.rule_version,
                "pins": decision.pins or [],
            },
        )
        await self._publisher.publish(conn, event)

        logger.info(
            "auto_approved case_id=%s tenant_id=%s decision_id=%s artifact=%s version=%s",
            case.case_id,
            case.tenant_id,
            decision.decision_id,
            decision.rule_artifact_id,
            decision.rule_version,
        )

        # Return the updated case with the decision appended in-memory
        return updated_case.model_copy(
            update={
                "decisions": (updated_case.decisions or []) + [decision]
            }
        )

    async def _route_to_clinical_review(
        self,
        conn: asyncpg.Connection,
        case: Case,
        correlation_id: str,
        reason: str,
    ) -> Case:
        """Transition the case to 'clinical_review' for human review.

        This path is taken for:
        - Digicore 'pending_review' response
        - Digicore 'denied' response (INVARIANT: human must make adverse determination)
        - Digicore circuit open or any exception

        No Decision is recorded on this path (a Decision is only recorded on
        the auto-approval path). The human reviewer will record the decision.
        """
        transition_req = TransitionRequest(
            case_id=case.case_id,
            tenant_id=case.tenant_id,
            to_state=Status.clinical_review,
            actor_id=_ACTOR_ID,
            actor_type=_ACTOR_TYPE,
            correlation_id=f"{correlation_id}-to-clinical",
            payload={"reason": reason},
            human_signoff_recorded=False,
        )
        updated_case, _event_id = await self._engine.apply(conn, transition_req)

        logger.info(
            "routed_to_clinical_review case_id=%s tenant_id=%s reason=%s",
            case.case_id,
            case.tenant_id,
            reason,
        )
        return updated_case
