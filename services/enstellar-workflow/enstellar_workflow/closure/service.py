"""Case closure — terminal `closed` state + disposition/audit stamp + CaseClosed."""
from __future__ import annotations

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from ..cases.repository import CaseRepository
from ..clocks.service import ClockService
from ..engine.transitions import TransitionEngine, TransitionRequest
from ..outbox.publisher import OutboxPublisher

# Cleanly-final outcomes that auto-close. appeal_upheld EXCLUDED (retains next-level
# appeal rights). Adverse determinations stay open for the appeal window.
AUTO_CLOSE_STATES: frozenset[str] = frozenset({"approved", "withdrawn", "appeal_overturned"})

# Settled states an explicit close is allowed FROM (NOT the in-flight states).
CLOSEABLE_STATES: frozenset[str] = frozenset({
    "approved", "denied", "partially_denied", "adverse_modification",
    "withdrawn", "appeal_overturned", "appeal_upheld",
})


class NotCloseableError(Exception):
    """Case is in an in-flight state (not settled) — mapped to HTTP 409."""


class AlreadyClosedError(Exception):
    """Case is already closed — mapped to HTTP 409."""


async def _do_close(conn, *, case, tenant_id, closed_by, reason, actor_type,
                    engine, clock_svc, publisher) -> None:
    """Transition case->closed (disposition=current status), stamp, stop clocks,
    emit CaseClosed. Caller guarantees the case is settled + not already closed."""
    disposition = case.status.value
    # Use the case's correlation_id so the closure events stay on the case's
    # lineage (audit/trace by correlation_id), not a detached fresh id.
    correlation_id = str(case.correlation_id)
    await engine.apply(conn, TransitionRequest(
        case_id=case.case_id, tenant_id=tenant_id, to_state="closed",
        actor_id=closed_by, actor_type=actor_type, correlation_id=correlation_id,
        payload={"disposition": disposition, "reason": reason},
    ))
    await conn.execute(
        "UPDATE workflow_instances SET disposition=$1, closed_at=now(), closed_by=$2, "
        "updated_at=now() WHERE case_id=$3 AND tenant_id=$4",
        disposition, closed_by, case.case_id, tenant_id,
    )
    for clock_type in ("decision", "appeal"):
        try:
            await clock_svc.stop(conn, tenant_id=tenant_id, case_id=case.case_id, clock_type=clock_type)
        except ValueError:
            pass
    await publisher.publish(conn, make_envelope(
        SchemaRef.CASE_CLOSED, tenant_id=tenant_id, actor_id=closed_by, actor_type=actor_type,
        correlation_id=correlation_id,
        payload={"case_id": str(case.case_id), "disposition": disposition, "closed_by": closed_by},
    ))


async def auto_close_if_resolved(conn, *, case, tenant_id, engine, clock_svc, publisher) -> None:
    """Close `case` if it just landed on a cleanly-final state (closed_by=system).
    No-op otherwise; `closed` not in AUTO_CLOSE_STATES -> no recursion."""
    if case.status.value in AUTO_CLOSE_STATES:
        await _do_close(conn, case=case, tenant_id=tenant_id, closed_by="system",
            reason=f"auto-close on {case.status.value}", actor_type="system",
            engine=engine, clock_svc=clock_svc, publisher=publisher)


class ClosureService:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._repo = CaseRepository()
        self._engine = TransitionEngine()
        self._publisher = OutboxPublisher()
        self._clock_svc = ClockService(self._publisher)

    async def close_case(self, *, case_id, tenant_id, closed_by, reason) -> dict:
        async with tenant_transaction(self._pool, tenant_id) as conn:
            case = await self._repo.fetch_by_id(conn, case_id, tenant_id)
            if case is None:
                raise NotCloseableError(f"case {case_id} not found")
            status = case.status.value
            if status == "closed":
                raise AlreadyClosedError(f"case {case_id} is already closed")
            if status not in CLOSEABLE_STATES:
                raise NotCloseableError(f"case is {status!r}, not a settled state")
            await _do_close(conn, case=case, tenant_id=tenant_id, closed_by=closed_by,
                reason=reason, actor_type="user", engine=self._engine,
                clock_svc=self._clock_svc, publisher=self._publisher)
            return {"case_id": str(case_id), "status": "closed", "disposition": status}
