"""SlaPoller — in-process background poller that enforces decision-clock SLAs.

Mirrors RevitalPoller / OutboxRelay's two-phase, cross-tenant design:

  1. A cross-tenant scan of RUNNING clocks joined to their OPEN (non-terminal)
     workflow_instances. Like the other pollers it reads EVERY tenant's rows, so
     it SET ROLE's to the BYPASSRLS ``sim_relay`` role on the scan connection.
  2. For each clock, in its OWN ``tenant_transaction``:
       - If the pause-adjusted deadline has passed → ``check_breach``. On a FRESH
         breach (check_breach returns non-None) resolve the (tenant, lob) SLA
         config and escalate the open case to the SLA queue (breach_mode).
       - Else, if not yet warned and elapsed (pause-adjusted) has crossed the
         per-(tenant, lob) warning threshold → ``warn`` (emits CLOCK_AT_RISK).

NEVER-THROW: the poll loop and ``_process_one`` must never throw out, so one bad
    row can never stall the sweep (mirrors RevitalPoller / OutboxRelay).
INVARIANT: the scan reads across tenants (sim_relay bypass); EVERY write happens
    inside ``tenant_transaction(tenant_id)``.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import asyncpg

from simintero_tenant_context import tenant_transaction

from ..config import get_settings
from ..escalation.service import EscalationService
from ..outbox.publisher import OutboxPublisher
from ..workflow_config import ConfigService
from .service import ClockService

logger = logging.getLogger(__name__)

# Terminal case states that the scan excludes (a terminal case is never
# breached/warned/escalated by the SLA monitor).
TERMINAL_STATES = (
    "approved",
    "denied",
    "partially_denied",
    "adverse_modification",
    "withdrawn",
    "closed",
    "determined",
    "voided",
    "appeal_overturned",
    "appeal_upheld",
)
_ACTOR_ID = "sla-monitor"
_ACTOR_TYPE = "service"


class SlaPoller:
    """Scans running clocks and breaches/warns/escalates them per SLA config."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._pub = OutboxPublisher()
        self._clocks = ClockService(self._pub)
        self._config = ConfigService()
        self._escalation = EscalationService(self._pub)
        self._running = False

    async def start(self) -> None:
        self._running = True
        settings = get_settings()
        while self._running:
            try:
                await self._poll_batch()
                await asyncio.sleep(settings.sla_poll_interval_seconds)
            except Exception:
                logger.exception("SlaPoller error — retrying after sleep")
                await asyncio.sleep(settings.sla_poll_interval_seconds)

    async def stop(self) -> None:
        self._running = False

    @asynccontextmanager
    async def _scan_conn(self):
        """Acquire a connection with the BYPASSRLS relay role set (if configured)."""
        role = get_settings().relay_db_role
        async with self._pool.acquire() as conn:
            if role:
                await conn.execute(f'SET ROLE "{role}"')
            try:
                yield conn
            finally:
                if role:
                    await conn.execute("RESET ROLE")

    async def _poll_batch(self) -> int:
        """Scan running clocks of OPEN cases (cross-tenant), then process each one.

        The scan happens inside its own short transaction on the sim_relay conn;
        per-clock work runs OUTSIDE that connection (its own tenant_transaction).
        """
        async with self._scan_conn() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """
                    SELECT c.tenant_id, c.case_id, c.clock_type, c.started_at,
                           c.deadline, c.total_paused_seconds, c.warned_at,
                           w.lob, w.status
                      FROM clocks c
                      JOIN workflow_instances w
                        ON w.case_id = c.case_id AND w.tenant_id = c.tenant_id
                     WHERE c.state = 'running'
                       AND c.clock_type IN ('decision', 'appeal')
                       AND w.status <> ALL($1::text[])
                    """,
                    list(TERMINAL_STATES),
                )

        for row in rows:
            await self._process_one(dict(row))
        return len(rows)

    async def _process_one(self, row: dict) -> None:
        """Handle a single running clock. NEVER raises out of this method."""
        try:
            now = datetime.now(timezone.utc)
            paused = float(row["total_paused_seconds"] or 0.0)
            effective_deadline = row["deadline"] + timedelta(seconds=paused)
            tenant_id = row["tenant_id"]
            case_id = row["case_id"]
            clock_type = row["clock_type"]

            async with tenant_transaction(self._pool, tenant_id) as conn:
                if now >= effective_deadline:
                    breached = await self._clocks.check_breach(
                        conn, tenant_id=tenant_id, case_id=case_id, clock_type=clock_type
                    )
                    # Escalate ONLY on the fresh-breach signal (non-None), never
                    # on every tick — check_breach is idempotent via state='running'.
                    if breached is not None:
                        sla = await self._config.resolve_sla(
                            conn, tenant_id=tenant_id, lob=row["lob"]
                        )
                        await self._escalation.escalate(
                            conn,
                            str(case_id),
                            tenant_id,
                            _ACTOR_ID,
                            _ACTOR_TYPE,
                            reason="sla_breach",
                            queue=sla.escalation_queue,
                            breach_mode=True,
                        )
                elif row["warned_at"] is None:
                    elapsed = (now - row["started_at"]).total_seconds() - paused
                    duration = (row["deadline"] - row["started_at"]).total_seconds()
                    if duration <= 0:
                        return
                    sla = await self._config.resolve_sla(
                        conn, tenant_id=tenant_id, lob=row["lob"]
                    )
                    if (elapsed / duration) * 100 >= sla.warning_threshold_pct:
                        await self._clocks.warn(
                            conn,
                            tenant_id=tenant_id,
                            case_id=case_id,
                            clock_type=clock_type,
                        )
        except Exception:
            logger.exception(
                "SlaPoller._process_one failed",
                extra={
                    "tenant_id": row.get("tenant_id"),
                    "case_id": str(row.get("case_id")),
                },
            )
