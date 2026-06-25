"""GrievanceSlaPoller — in-process background poller that escalates overdue grievances.

Mirrors clocks/sla_poller.py's two-phase, cross-tenant design:

  1. A cross-tenant scan of non-resolved grievances whose acknowledgement- or
     resolution-due-date has passed and whose corresponding breach flag is still
     NULL. Like the other pollers it reads EVERY tenant's rows, so it SET ROLE's
     to the BYPASSRLS ``sim_relay`` role on the scan connection.
  2. For each grievance, in its OWN ``tenant_transaction``: stamp each applicable
     breach flag (idempotent — True only on the FRESH stamp), and on a fresh
     breach publish GrievanceSlaBreached + dispatch an internal overdue notice.

NEVER-THROW: the poll loop and ``_process_one`` never throw out, so one bad row
    can never stall the sweep. INVARIANT: the scan reads across tenants
    (sim_relay bypass); EVERY write happens inside ``tenant_transaction(tenant_id)``.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from ..config import get_settings
from ..comms.service import NotificationService
from ..outbox.publisher import OutboxPublisher
from .repository import GrievanceRepository

logger = logging.getLogger(__name__)

_ACTOR_ID = "sla-monitor"
_ACTOR_TYPE = "service"


class GrievanceSlaPoller:
    """Scans non-resolved grievances and escalates the overdue ones once each."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self._pub = OutboxPublisher()
        self._notify = NotificationService(self._pub)
        self._repo = GrievanceRepository()
        self._running = False

    async def start(self) -> None:
        self._running = True
        settings = get_settings()
        while self._running:
            try:
                await self._poll_batch()
                await asyncio.sleep(settings.sla_poll_interval_seconds)
            except Exception:
                logger.exception("GrievanceSlaPoller error — retrying after sleep")
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
        """Scan overdue, non-resolved grievances (cross-tenant), then process each one.

        The scan happens inside its own short transaction on the sim_relay conn;
        per-grievance work runs OUTSIDE that connection (its own tenant_transaction).
        """
        async with self._scan_conn() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """
                    SELECT grievance_id, tenant_id, status, lob,
                           acknowledgement_due_at, resolution_due_at,
                           acknowledgement_breached_at, resolution_breached_at
                      FROM grievances
                     WHERE status <> 'resolved'
                       AND ( (status='filed' AND acknowledgement_due_at < now()
                              AND acknowledgement_breached_at IS NULL)
                          OR (resolution_due_at < now()
                              AND resolution_breached_at IS NULL) )
                    """
                )

        for row in rows:
            await self._process_one(dict(row))
        return len(rows)

    async def _process_one(self, row: dict) -> None:
        """Handle a single grievance. NEVER raises out of this method."""
        try:
            now = datetime.now(timezone.utc)
            gid = row["grievance_id"]
            tenant_id = row["tenant_id"]
            status = row["status"]
            lob = row["lob"]
            ack_due = row["acknowledgement_due_at"]
            res_due = row["resolution_due_at"]

            breaches: list[tuple[str, datetime]] = []
            if (
                status == "filed"
                and ack_due is not None
                and ack_due < now
                and row["acknowledgement_breached_at"] is None
            ):
                breaches.append(("acknowledgement", ack_due))
            if (
                status != "resolved"
                and res_due is not None
                and res_due < now
                and row["resolution_breached_at"] is None
            ):
                breaches.append(("resolution", res_due))

            if not breaches:
                return

            async with tenant_transaction(self._pool, tenant_id) as conn:
                for breach_type, due_at in breaches:
                    fresh = await self._repo.mark_breached(
                        conn,
                        grievance_id=gid,
                        tenant_id=tenant_id,
                        breach_type=breach_type,
                    )
                    if not fresh:
                        # Lost the race to a concurrent poll → already escalated.
                        continue
                    await self._pub.publish(
                        conn,
                        make_envelope(
                            SchemaRef.GRIEVANCE_SLA_BREACHED,
                            tenant_id=tenant_id,
                            actor_id=_ACTOR_ID,
                            actor_type=_ACTOR_TYPE,
                            correlation_id=str(gid),
                            payload={
                                "grievance_id": str(gid),
                                "breach_type": breach_type,
                                "due_at": due_at.isoformat(),
                            },
                        ),
                    )
                    await self._notify.render_and_dispatch(
                        conn,
                        tenant_id,
                        str(gid),
                        event_type=f"grievance_{breach_type}_overdue",
                        context={"grievance_id": str(gid), "breach_type": breach_type},
                        actor_id=_ACTOR_ID,
                        actor_type=_ACTOR_TYPE,
                        lob=lob,
                    )
        except Exception:
            logger.exception(
                "GrievanceSlaPoller._process_one failed",
                extra={
                    "tenant_id": row.get("tenant_id"),
                    "grievance_id": str(row.get("grievance_id")),
                },
            )
