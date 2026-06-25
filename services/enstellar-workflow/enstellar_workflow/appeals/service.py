"""AppealService — files (and later decides) appeals on adverse determinations.

file_appeal turns an adverse case into an `appeal_review`:
  * eligibility (adverse → level 1; an upheld appeal below MAX → next level)
  * insert the appeal record
  * STOP the prior clock (decision for L1 / appeal for L>1) then START a fresh
    appeal clock — so the generalized SLA poller monitors only one running clock
  * transition the case → appeal_review and route it to the level queue
  * emit AppealFiled + render the appeal_filed acknowledgement notice

All writes happen in a single tenant_transaction (RLS-scoped).
"""
from __future__ import annotations

import uuid

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from ..clocks.service import ClockService
from ..comms.service import NotificationService
from ..outbox.publisher import OutboxPublisher
from ..workflow_config import ConfigService
from .repository import AppealsRepository

MAX_APPEAL_LEVEL = 3
APPEALABLE_ADVERSE = {"denied", "partially_denied", "adverse_modification"}


class AppealNotAllowedError(Exception):
    """Raised when a case is not eligible for an appeal (mapped to HTTP 409)."""


class AppealConflictError(Exception):
    """Raised when an appeal is no longer under_review (mapped to HTTP 409)."""


class COIError(Exception):
    """Raised when an appeal reviewer is not independent — i.e. the reviewer is
    the original adverse determiner, or (level >= 2) the prior-level reviewer.
    Mapped to HTTP 409."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class NotAssignedError(Exception):
    """Raised when a reviewer tries to decide an appeal not assigned to them.

    The decide route stamps reviewer_actor from the authenticated JWT ``sub``;
    this gate makes the COI check enforceable rather than advisory — only the
    reviewer the appeal is assigned to may decide it. Mapped to HTTP 403."""


class AppealService:
    def __init__(self, pool: asyncpg.Pool) -> None:
        # Lazy import breaks the engine ↔ cases circular dependency at init time.
        from ..engine.transitions import TransitionEngine
        from ..cases.repository import CaseRepository

        self._pool = pool
        self._pub = OutboxPublisher()
        self._clock_svc = ClockService(self._pub)
        self._config_svc = ConfigService()
        self._appeals = AppealsRepository()
        self._engine = TransitionEngine()
        self._notify = NotificationService(self._pub)
        self._cases = CaseRepository()

    async def file_appeal(
        self,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        filed_by: str,
        reason: str | None,
    ) -> dict:
        from ..engine.transitions import TransitionRequest

        async with tenant_transaction(self._pool, tenant_id) as conn:
            case = await self._cases.fetch_by_id(conn, case_id, tenant_id)
            if case is None:
                raise AppealNotAllowedError(
                    f"Case {case_id} not found for tenant {tenant_id!r}"
                )
            latest = await self._appeals.latest_appeal(conn, case_id, tenant_id)

            status = case.status.value
            if status in APPEALABLE_ADVERSE:
                level = 1
                appealed_ref = (
                    str(case.decisions[-1].decision_id)
                    if case.decisions
                    else str(case_id)
                )
                stop_clock_type = "decision"
            elif (
                status == "appeal_upheld"
                and latest is not None
                and latest["level"] < MAX_APPEAL_LEVEL
            ):
                level = latest["level"] + 1
                appealed_ref = str(latest["appeal_id"])
                stop_clock_type = "appeal"
            else:
                raise AppealNotAllowedError(
                    f"Case {case_id} (status={status!r}) is not eligible for an appeal"
                )

            try:
                appeal = await self._appeals.insert_appeal(
                    conn,
                    case_id=case_id,
                    tenant_id=tenant_id,
                    level=level,
                    appealed_ref=appealed_ref,
                    filed_by=filed_by,
                    reason=reason,
                )
            except asyncpg.UniqueViolationError:
                raise AppealNotAllowedError(
                    "an appeal is already under review for this case"
                )

            # Stop the prior clock BEFORE starting the appeal clock so only one
            # running clock exists per case (the poller monitors single clocks).
            try:
                await self._clock_svc.stop(
                    conn,
                    tenant_id=tenant_id,
                    case_id=case_id,
                    clock_type=stop_clock_type,
                )
            except ValueError:
                pass  # no stoppable prior clock — non-fatal

            defn = await self._config_svc.resolve_clock(
                conn,
                tenant_id=tenant_id,
                lob=case.lob,
                urgency=case.urgency.value,
                clock_type="appeal",
            )
            await self._clock_svc.start(
                conn,
                tenant_id=tenant_id,
                case_id=case_id,
                definition=defn,
            )

            queue = "independent_review" if level >= 2 else f"appeal_l{level}_review"
            await self._engine.apply(
                conn,
                TransitionRequest(
                    case_id=case_id,
                    tenant_id=tenant_id,
                    to_state="appeal_review",
                    actor_id="system",
                    actor_type="system",
                    correlation_id=str(uuid.uuid4()),
                    payload={
                        "reason": "appeal_filed",
                        "appeal_id": str(appeal["appeal_id"]),
                        "level": level,
                    },
                ),
            )
            await conn.execute(
                "UPDATE workflow_instances SET assignee_queue=$1, updated_at=now() "
                "WHERE case_id=$2 AND tenant_id=$3",
                queue, case_id, tenant_id,
            )

            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.APPEAL_FILED,
                    tenant_id=tenant_id,
                    actor_id="system",
                    actor_type="system",
                    correlation_id=str(appeal["appeal_id"]),
                    payload={
                        "case_id": str(case_id),
                        "appeal_id": str(appeal["appeal_id"]),
                        "level": level,
                        "appealed_ref": appealed_ref,
                        "filed_by": filed_by,
                    },
                ),
            )
            await self._notify.render_and_dispatch(
                conn,
                tenant_id,
                str(case_id),
                event_type="appeal_filed",
                context={"case_id": str(case_id), "level": level, "reason": reason},
                actor_id="system",
                actor_type="system",
                correlation_id=str(appeal["appeal_id"]),
            )

        return {
            "appeal_id": str(appeal["appeal_id"]),
            "level": level,
            "status": "appeal_review",
        }

    async def decide_appeal(
        self,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        appeal_id: uuid.UUID,
        outcome: str,
        reviewer_actor: str,
        reason: str | None,
        human_signoff_recorded: bool,
    ) -> dict:
        """Decide an under_review appeal — overturn or uphold.

        An `upheld` outcome is a continued adverse determination and therefore
        requires a recorded human sign-off (the gate fires BEFORE any DB write,
        so a gated uphold leaves the case in appeal_review + the appeal
        under_review). The appeal_* states are NOT determination states, so the
        transition emits no DECISION_RECORDED — the appeals row is the record and
        the explicit appeal_overturned/appeal_upheld notice is the only comms.
        """
        from ..engine.guards import GuardError
        from ..engine.transitions import TransitionRequest

        if outcome not in {"overturned", "upheld"}:
            raise ValueError(f"invalid appeal outcome {outcome!r}")

        # Uphold gate — BEFORE any write.
        if outcome == "upheld" and not human_signoff_recorded:
            raise GuardError(
                "appeal uphold (continued adverse) requires human sign-off"
            )

        to_state = "appeal_overturned" if outcome == "overturned" else "appeal_upheld"

        async with tenant_transaction(self._pool, tenant_id) as conn:
            # COI guard — runs BEFORE any write, so a violation aborts the tx
            # (nothing committed: the appeal stays under_review, case appeal_review).
            appeal = await self._appeals.fetch(conn, appeal_id, tenant_id)
            if appeal is None or appeal["status"] != "under_review":
                raise AppealConflictError(
                    f"Appeal {appeal_id} is not under_review (already decided or not found)"
                )
            # Assignment gate — a reviewer may only decide an appeal assigned to
            # them. Runs BEFORE the COI block so a decide-time COI test (which
            # sets assigned_to == the conflicted reviewer) still reaches COI.
            if appeal.get("assigned_to") != reviewer_actor:
                raise NotAssignedError(
                    f"appeal {appeal_id} is not assigned to {reviewer_actor!r}"
                )
            determiner = await self._appeals.adverse_determiner(
                conn, case_id, tenant_id
            )
            if determiner is not None and reviewer_actor == determiner:
                raise COIError(
                    "appeal reviewer must differ from the original determiner"
                )
            if appeal["level"] >= 2:
                prior = await self._appeals.appeal_at_level(
                    conn, case_id, tenant_id, appeal["level"] - 1
                )
                if (
                    prior
                    and prior.get("reviewer_actor")
                    and reviewer_actor == prior["reviewer_actor"]
                ):
                    raise COIError(
                        "appeal reviewer must differ from the prior-level reviewer"
                    )

            row = await self._appeals.record_outcome(
                conn,
                appeal_id=appeal_id,
                tenant_id=tenant_id,
                status=outcome,
                outcome_reason=reason,
                reviewer_actor=reviewer_actor,
            )
            if row is None:
                raise AppealConflictError(
                    f"Appeal {appeal_id} is not under_review (already decided or not found)"
                )

            # Stop the appeal clock (non-fatal — already stopped is fine).
            try:
                await self._clock_svc.stop(
                    conn,
                    tenant_id=tenant_id,
                    case_id=case_id,
                    clock_type="appeal",
                )
            except ValueError:
                pass

            updated_case, _evt = await self._engine.apply(
                conn,
                TransitionRequest(
                    case_id=case_id,
                    tenant_id=tenant_id,
                    to_state=to_state,
                    actor_id="system",
                    actor_type="system",
                    correlation_id=str(uuid.uuid4()),
                    # For appeal_upheld (continued adverse), forward the sign-off flag so
                    # the SIGNOFF_REQUIRED_STATES guard in adverse_transition_guard passes.
                    # The uphold sign-off gate above already validated this is True for upholds.
                    # For appeal_overturned, human_signoff_recorded may be False — that is fine
                    # because appeal_overturned is not in SIGNOFF_REQUIRED_STATES.
                    human_signoff_recorded=human_signoff_recorded,
                    payload={
                        "reason": "appeal_decided",
                        "appeal_id": str(appeal_id),
                        "outcome": outcome,
                    },
                ),
            )

            await self._pub.publish(
                conn,
                make_envelope(
                    SchemaRef.APPEAL_DECIDED,
                    tenant_id=tenant_id,
                    actor_id="system",
                    actor_type="system",
                    correlation_id=str(appeal_id),
                    payload={
                        "case_id": str(case_id),
                        "appeal_id": str(appeal_id),
                        "level": row["level"],
                        "outcome": outcome,
                        "reviewer_actor": reviewer_actor,
                    },
                ),
            )
            await self._notify.render_and_dispatch(
                conn,
                tenant_id,
                str(case_id),
                event_type=to_state,
                context={"case_id": str(case_id), "level": row["level"]},
                actor_id="system",
                actor_type="system",
                correlation_id=str(appeal_id),
            )

            # Auto-close on a cleanly-final appeal outcome. Only appeal_overturned
            # is in AUTO_CLOSE_STATES; appeal_upheld is a no-op (retains next-level
            # appeal rights). DB side effect only — the returned dict is unchanged.
            from ..closure.service import auto_close_if_resolved
            await auto_close_if_resolved(
                conn, case=updated_case, tenant_id=tenant_id,
                engine=self._engine, clock_svc=self._clock_svc,
                publisher=self._pub,
            )

        return {
            "appeal_id": str(appeal_id),
            "outcome": outcome,
            "status": to_state,
        }

    async def list_assigned(
        self, *, tenant_id: str, reviewer_sub: str
    ) -> list[dict]:
        """The reviewer's open (under_review) assigned appeals, newest first."""
        async with tenant_transaction(self._pool, tenant_id) as conn:
            rows = await self._appeals.assigned_appeals(
                conn, tenant_id=tenant_id, reviewer_sub=reviewer_sub
            )
        return [
            {
                **r,
                "appeal_id": str(r["appeal_id"]),
                "case_id": str(r["case_id"]),
                "filed_at": r["filed_at"].isoformat() if r.get("filed_at") else None,
                "assigned_at": (
                    r["assigned_at"].isoformat() if r.get("assigned_at") else None
                ),
            }
            for r in rows
        ]

    async def assign_reviewer(
        self,
        *,
        case_id: uuid.UUID,
        tenant_id: str,
        appeal_id: uuid.UUID,
        reviewer_id: str,
        assigned_by: str,
    ) -> dict:
        """Assign a reviewer to an under_review appeal (COI-checked).

        The assigned reviewer must be independent: they cannot be the original
        adverse determiner, nor (level >= 2) the prior-level reviewer. The COI
        check runs BEFORE the write, so a violation commits nothing.
        """
        async with tenant_transaction(self._pool, tenant_id) as conn:
            appeal = await self._appeals.fetch(conn, appeal_id, tenant_id)
            if appeal is None or appeal["status"] != "under_review":
                raise AppealConflictError(
                    f"Appeal {appeal_id} is not under_review (already decided or not found)"
                )
            determiner = await self._appeals.adverse_determiner(
                conn, case_id, tenant_id
            )
            if determiner is not None and reviewer_id == determiner:
                raise COIError(
                    "assigned reviewer must differ from the original determiner"
                )
            if appeal["level"] >= 2:
                prior = await self._appeals.appeal_at_level(
                    conn, case_id, tenant_id, appeal["level"] - 1
                )
                if (
                    prior
                    and prior.get("reviewer_actor")
                    and reviewer_id == prior["reviewer_actor"]
                ):
                    raise COIError(
                        "assigned reviewer must differ from the prior-level reviewer"
                    )

            row = await self._appeals.assign(
                conn,
                appeal_id=appeal_id,
                tenant_id=tenant_id,
                reviewer_id=reviewer_id,
                assigned_by=assigned_by,
            )
            if row is None:
                raise AppealConflictError(
                    f"Appeal {appeal_id} is not under_review"
                )
            return {
                "appeal_id": str(appeal_id),
                "assigned_to": reviewer_id,
                "status": row["status"],
            }
