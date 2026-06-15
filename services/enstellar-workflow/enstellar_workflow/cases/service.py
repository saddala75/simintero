"""CaseService — application-level orchestration for case lifecycle.

Owns the transaction boundaries for create_case and transition.
CaseRepository and TransitionEngine handle the DB writes;
CaseService coordinates them and the asyncpg pool.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg

from typing import TYPE_CHECKING

from canonical_model import Case
from enstellar_events import Actor, ActorType, EventEnvelope, SchemaRef

from ..clocks.model import ClockDefinition
from ..clocks.service import ClockService
from ..db.connection import tenant_conn
from ..escalation.service import EscalationService
from ..outbox.publisher import OutboxPublisher
from ..rfi.service import RfiRequest, RfiService
from ..signoff.service import SignoffService
from .repository import CaseRepository

if TYPE_CHECKING:
    from ..engine.transitions import TransitionRequest

_TERMINAL_STATES: frozenset[str] = frozenset(
    {"approved", "denied", "partially_denied", "adverse_modification", "withdrawn"}
)


class CaseService:
    def __init__(self, pool: asyncpg.Pool) -> None:
        # Lazy import breaks engine ↔ cases circular dependency at module init time.
        from ..engine.transitions import TransitionEngine
        self._pool = pool
        self._repo = CaseRepository()
        self._engine = TransitionEngine()
        self._publisher = OutboxPublisher()
        self._clock_svc = ClockService(self._publisher)
        self._rfi_svc = RfiService(self._publisher)

    async def create_case(self, case: Case) -> Case:
        """Create a case, idempotent on (correlation_id, tenant_id).

        If a row with the same correlation_id already exists for this tenant,
        returns the existing case with no side-effects. Otherwise inserts the
        row and writes a case.intake.received event to the outbox — both in a
        single transaction.
        """
        async with tenant_conn(self._pool, case.tenant_id) as conn:
            async with conn.transaction():
                # Attempt idempotent insert — ON CONFLICT returns no row
                row = await conn.fetchrow(
                    """
                    INSERT INTO workflow_instances
                      (case_id, tenant_id, correlation_id, lob, program, status, urgency,
                       workflow_def_version, case_json, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
                    ON CONFLICT (correlation_id) DO NOTHING
                    RETURNING case_id
                    """,
                    case.case_id,
                    case.tenant_id,
                    case.correlation_id,
                    case.lob,
                    case.program,
                    case.status.value,
                    case.urgency.value,
                    "v1",
                    json.dumps(case.model_dump(mode="json")),
                    case.created_at,
                    case.updated_at,
                )

                if row is None:
                    # Duplicate correlation_id — return existing case without side-effects
                    existing = await self._repo.fetch_by_correlation_id(
                        conn, case.correlation_id, case.tenant_id
                    )
                    return existing  # type: ignore[return-value]

                # New case — publish intake event to outbox in same transaction
                event = EventEnvelope(
                    event_id=uuid.uuid4(),
                    tenant_id=case.tenant_id,
                    case_id=case.case_id,
                    correlation_id=case.correlation_id,
                    schema_ref=SchemaRef.CASE_INTAKE_RECEIVED,
                    occurred_at=case.created_at,
                    actor=Actor(id="system", type=ActorType.SYSTEM),
                    payload={"status": case.status.value},
                )
                await self._publisher.publish(conn, event)

                # Start the decision clock for the new case
                try:
                    defn = ClockDefinition.for_case(case.urgency.value)
                    await self._clock_svc.start(
                        conn,
                        tenant_id=case.tenant_id,
                        case_id=case.case_id,
                        definition=defn,
                    )
                except ValueError:
                    # Unknown urgency/clock_type — clock not started; non-fatal
                    pass

                return case

    async def transition(self, req: TransitionRequest) -> Case:
        """Apply a state transition.

        Wraps TransitionEngine.apply in a transaction. GuardError propagates
        unchanged so the API layer can convert it to HTTP 409. If the new state
        is terminal, the decision clock is stopped in the same transaction.
        Platform is notified after the transaction commits (fire-and-forget).
        """
        engine: TransitionEngine = self._engine
        from_state: str | None = None
        async with tenant_conn(self._pool, req.tenant_id) as conn:
            async with conn.transaction():
                # Capture from_state before apply() mutates the case
                pre_case = await self._repo.fetch_by_id(conn, req.case_id, req.tenant_id)
                if pre_case is not None:
                    from_state = pre_case.status.value
                case, event_id = await engine.apply(conn, req)
                if case.status.value in _TERMINAL_STATES:
                    try:
                        await self._clock_svc.stop(
                            conn,
                            tenant_id=req.tenant_id,
                            case_id=req.case_id,
                        )
                    except ValueError:
                        pass  # No clock exists (or already stopped) — non-fatal
        # Notify platform OUTSIDE the transaction (fire-and-forget)
        if from_state is not None:
            await engine.notify_platform(req, from_state=from_state, event_id=event_id)
        return case

    async def pend_rfi(
        self,
        case_id: uuid.UUID,
        tenant_id: str,
        provider_npi: str,
        document_types: list[str],
        free_text: str | None,
        requested_by: str,
    ) -> dict:
        """Transition case to pend_rfi state, pause the clock, dispatch RFI.

        All three side-effects happen in a single transaction:
        1. Transition workflow state to 'pend_rfi'
        2. Pause the decision clock
        3. Emit rfi.dispatched outbox event

        Returns a dict with the updated case and RFI request_id.
        """
        from ..engine.transitions import TransitionRequest

        pend_req: TransitionRequest | None = None
        pend_event_id: uuid.UUID | None = None
        pend_from_state: str | None = None
        async with tenant_conn(self._pool, tenant_id) as conn:
            async with conn.transaction():
                pre_case = await self._repo.fetch_by_id(conn, case_id, tenant_id)
                if pre_case is not None:
                    pend_from_state = pre_case.status.value
                pend_req = TransitionRequest(
                    case_id=case_id,
                    tenant_id=tenant_id,
                    to_state="pend_rfi",
                    actor_id=requested_by,
                    actor_type="user",
                    correlation_id=str(uuid.uuid4()),
                    payload={"reason": "rfi_dispatched"},
                )
                case, pend_event_id = await self._engine.apply(conn, pend_req)

                # Pause the decision clock
                try:
                    await self._clock_svc.pause(
                        conn,
                        tenant_id=tenant_id,
                        case_id=case_id,
                        reason="rfi_dispatched",
                    )
                except ValueError:
                    pass  # No clock — non-fatal

                rfi_req = RfiRequest(
                    case_id=case_id,
                    tenant_id=tenant_id,
                    provider_npi=provider_npi,
                    document_types=document_types,
                    free_text=free_text,
                    requested_by=requested_by,
                )
                request_id = await self._rfi_svc.dispatch_rfi(conn, rfi_req)

        # Notify platform OUTSIDE the transaction (fire-and-forget)
        if pend_req is not None and pend_from_state is not None and pend_event_id is not None:
            await self._engine.notify_platform(pend_req, from_state=pend_from_state, event_id=pend_event_id)
        return {"case": case, "rfi_request_id": str(request_id)}

    async def escalate(
        self,
        case_id: uuid.UUID,
        tenant_id: str,
        actor: Actor,
        reason: str | None = None,
        correlation_id: str | None = None,
    ) -> dict:
        """Escalate a case to the md_review queue (must be in clinical_review state).

        Raises ValueError (caller maps to 409) if the case is not in clinical_review
        or does not exist for the given tenant.
        """
        svc = EscalationService(self._publisher)
        async with tenant_conn(self._pool, tenant_id) as conn:
            async with conn.transaction():
                return await svc.escalate(
                    conn, str(case_id), tenant_id, actor, reason, correlation_id
                )

    async def record_signoff(
        self,
        case_id: uuid.UUID,
        tenant_id: str,
        actor_id: str,
        actor_type: str,
        outcome_context: str,
    ) -> dict:
        """Record human clinician sign-off for an adverse determination.

        Returns the signoff row as a plain dict.
        """
        svc = SignoffService()
        async with tenant_conn(self._pool, tenant_id) as conn:
            async with conn.transaction():
                return await svc.record_signoff(
                    conn, str(case_id), tenant_id, actor_id, actor_type, outcome_context
                )

    async def get_events(
        self, case_id: uuid.UUID, tenant_id: str
    ) -> list[dict[str, Any]]:
        """Return all workflow_events rows for a case, ordered by insertion (id ASC)."""
        async with tenant_conn(self._pool, tenant_id) as conn:
            rows = await conn.fetch(
                """
                SELECT id, case_id, tenant_id, event_type, from_state, to_state,
                       actor_id, actor_type, correlation_id, payload, occurred_at
                FROM workflow_events
                WHERE case_id = $1 AND tenant_id = $2
                ORDER BY id ASC
                """,
                case_id,
                tenant_id,
            )

        result = []
        for row in rows:
            payload = row["payload"]
            if isinstance(payload, str):
                payload = json.loads(payload)
            result.append(
                {
                    "id": row["id"],
                    "case_id": str(row["case_id"]),
                    "tenant_id": row["tenant_id"],
                    "event_type": row["event_type"],
                    "from_state": row["from_state"],
                    "to_state": row["to_state"],
                    "actor_id": row["actor_id"],
                    "actor_type": row["actor_type"],
                    "correlation_id": row["correlation_id"],
                    "payload": payload,
                    "occurred_at": row["occurred_at"].isoformat(),
                }
            )
        return result
