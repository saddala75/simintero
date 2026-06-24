"""ClockService — manages decision-clock lifecycle in the outbox pattern.

All DB mutations + outbox writes happen in a SINGLE asyncpg transaction
passed in by the caller (CaseService). ClockService never opens its own
connection — it is a pure "unit-of-work participant."
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef, make_envelope
from ..outbox.publisher import OutboxPublisher
from .model import ClockDefinition, ClockState


class ClockService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    # ------------------------------------------------------------------
    # start
    # ------------------------------------------------------------------

    async def start(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        definition: ClockDefinition,
    ) -> ClockState:
        """Insert a new running clock row and emit a ClockStarted outbox event.

        Raises ValueError if a non-stopped clock already exists for
        (case_id, clock_type) — callers must stop the old clock first.
        """
        now = datetime.now(timezone.utc)
        deadline = now + timedelta(days=definition.duration_calendar_days)
        clock_id = uuid.uuid4()

        row = await conn.fetchrow(  # nosemgrep: python.lang.security.audit.sqli.asyncpg-sqli.asyncpg-sqli -- hardcoded SQL literal with $N positional params; no string concatenation
            """
            INSERT INTO clocks
              (clock_id, tenant_id, case_id, clock_type, state, urgency,
               duration_calendar_days, started_at, deadline,
               paused_at, total_paused_seconds, breached_at)
            VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, NULL, 0.0, NULL)
            ON CONFLICT (case_id, clock_type) DO NOTHING
            RETURNING *
            """,
            clock_id,
            tenant_id,
            case_id,
            definition.clock_type,
            definition.urgency,
            definition.duration_calendar_days,
            now,
            deadline,
        )

        if row is None:
            raise ValueError(
                f"Clock ({case_id}, {definition.clock_type}) already exists. "
                "Stop it before starting a new one."
            )

        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(
                tenant_id=tenant_id,
                case_id=case_id,
                clock_id=state.clock_id,
                schema_ref=SchemaRef.CLOCK_STARTED,
                payload={
                    "clock_type": definition.clock_type,
                    "urgency": definition.urgency,
                    "deadline": deadline.isoformat(),
                    "duration_calendar_days": definition.duration_calendar_days,
                },
            ),
        )
        return state

    # ------------------------------------------------------------------
    # pause
    # ------------------------------------------------------------------

    async def pause(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        clock_type: str = "decision",
        reason: str | None = None,
    ) -> ClockState:
        """Pause a running clock (e.g., while waiting for RFI response).

        No-ops and returns current state if already paused.
        Raises ValueError if the clock does not exist or is not running/paused.
        """
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE clocks
               SET state    = 'paused',
                   paused_at = CASE WHEN state = 'running' THEN $3 ELSE paused_at END,
                   updated_at = $3
             WHERE case_id = $1 AND clock_type = $2 AND tenant_id = $4
               AND state IN ('running', 'paused')
            RETURNING *
            """,
            case_id,
            clock_type,
            now,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No running/paused clock for case_id={case_id}, clock_type={clock_type}"
            )

        state = _row_to_state(row)
        if state.paused_at and (now - state.paused_at).total_seconds() < 1:
            # We just set paused_at → emit event only on first pause
            await self._pub.publish(
                conn,
                _make_event(
                    tenant_id=tenant_id,
                    case_id=case_id,
                    clock_id=state.clock_id,
                    schema_ref=SchemaRef.CLOCK_PAUSED,
                    payload={"reason": reason, "paused_at": now.isoformat()},
                ),
            )
        return state

    # ------------------------------------------------------------------
    # resume
    # ------------------------------------------------------------------

    async def resume(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        clock_type: str = "decision",
    ) -> ClockState:
        """Resume a paused clock, accumulating the pause duration.

        Raises ValueError if the clock does not exist or is not paused.
        """
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE clocks
               SET state               = 'running',
                   total_paused_seconds = total_paused_seconds
                                         + EXTRACT(EPOCH FROM ($3 - paused_at)),
                   paused_at           = NULL,
                   updated_at          = $3
             WHERE case_id = $1 AND clock_type = $2 AND tenant_id = $4
               AND state = 'paused'
            RETURNING *
            """,
            case_id,
            clock_type,
            now,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No paused clock for case_id={case_id}, clock_type={clock_type}"
            )

        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(
                tenant_id=tenant_id,
                case_id=case_id,
                clock_id=state.clock_id,
                schema_ref=SchemaRef.CLOCK_RESUMED,
                payload={
                    "resumed_at": now.isoformat(),
                    "total_paused_seconds": state.total_paused_seconds,
                },
            ),
        )
        return state

    # ------------------------------------------------------------------
    # check_breach
    # ------------------------------------------------------------------

    async def check_breach(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        clock_type: str = "decision",
    ) -> ClockState | None:
        """Mark clock breached if deadline has passed. Returns new state or None.

        Returns None if the clock doesn't exist, is not running, or deadline
        has not yet passed. The deadline checked is the RAW db deadline; the
        caller (SLA monitor) must account for accumulated pause time if needed.
        """
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE clocks
               SET state      = 'breached',
                   breached_at = $3,
                   updated_at  = $3
             WHERE case_id = $1 AND clock_type = $2 AND tenant_id = $4
               AND state = 'running'
               AND deadline + (total_paused_seconds || ' seconds')::interval <= $3
            RETURNING *
            """,
            case_id,
            clock_type,
            now,
            tenant_id,
        )
        if row is None:
            return None

        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(
                tenant_id=tenant_id,
                case_id=case_id,
                clock_id=state.clock_id,
                schema_ref=SchemaRef.CLOCK_BREACHED,
                payload={
                    "clock_type": clock_type,
                    "breached_at": now.isoformat(),
                    "deadline": state.deadline.isoformat(),
                },
            ),
        )
        return state

    # ------------------------------------------------------------------
    # warn
    # ------------------------------------------------------------------

    async def warn(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        clock_type: str = "decision",
    ) -> ClockState | None:
        """Mark a running clock as at-risk (warned) and emit CLOCK_AT_RISK.

        Idempotent: only fires for a running clock whose warned_at is still
        NULL. Returns the new state, or None if there was nothing to warn
        (no running clock, or it was already warned).
        """
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE clocks
               SET warned_at  = $3,
                   updated_at = $3
             WHERE case_id = $1 AND clock_type = $2 AND tenant_id = $4
               AND state = 'running'
               AND warned_at IS NULL
            RETURNING *
            """,
            case_id,
            clock_type,
            now,
            tenant_id,
        )
        if row is None:
            return None

        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(
                tenant_id=tenant_id,
                case_id=case_id,
                clock_id=state.clock_id,
                schema_ref=SchemaRef.CLOCK_AT_RISK,
                payload={
                    "clock_type": clock_type,
                    "deadline": state.deadline.isoformat(),
                    "warned_at": now.isoformat(),
                },
            ),
        )
        return state

    # ------------------------------------------------------------------
    # stop
    # ------------------------------------------------------------------

    async def stop(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        case_id: uuid.UUID,
        clock_type: str = "decision",
    ) -> ClockState:
        """Stop a clock (terminal state — running, paused, or breached clocks only).

        A stopped clock is removed from breach-checking. Raises ValueError if
        the clock does not exist or is already stopped.
        """
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE clocks
               SET state      = 'stopped',
                   updated_at  = $3
             WHERE case_id = $1 AND clock_type = $2 AND tenant_id = $4
               AND state != 'stopped'
            RETURNING *
            """,
            case_id,
            clock_type,
            now,
            tenant_id,
        )
        if row is None:
            raise ValueError(
                f"No stoppable clock for case_id={case_id}, clock_type={clock_type} "
                f"(does not exist or already stopped)"
            )

        state = _row_to_state(row)
        await self._pub.publish(
            conn,
            _make_event(
                tenant_id=tenant_id,
                case_id=case_id,
                clock_id=state.clock_id,
                schema_ref=SchemaRef.CLOCK_STOPPED,
                payload={
                    "clock_type": clock_type,
                    "stopped_at": now.isoformat(),
                },
            ),
        )
        return state


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _row_to_state(row: asyncpg.Record) -> ClockState:
    return ClockState(
        clock_id=str(row["clock_id"]),
        tenant_id=row["tenant_id"],
        case_id=str(row["case_id"]),
        clock_type=row["clock_type"],
        state=row["state"],
        deadline=row["deadline"].replace(tzinfo=timezone.utc)
        if row["deadline"].tzinfo is None
        else row["deadline"],
        paused_at=(
            row["paused_at"].replace(tzinfo=timezone.utc)
            if row["paused_at"] is not None and row["paused_at"].tzinfo is None
            else row["paused_at"]
        ),
        total_paused_seconds=float(row["total_paused_seconds"]),
        breached_at=row["breached_at"],
    )


def _make_event(
    *,
    tenant_id: str,
    case_id: uuid.UUID,
    clock_id: str,
    schema_ref: str,
    payload: dict[str, Any],
) -> EventEnvelope:
    return make_envelope(
        schema_ref,
        tenant_id=tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=str(clock_id),
        payload={"case_id": str(case_id), **payload},
    )
