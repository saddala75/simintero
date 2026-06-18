"""RevitalPoller — background poller that completes in-flight Revital analyses.

The ClinicalReviewConsumer submits a C-2 analysis to Revital and records a
``revital_inflight`` row (status 'processing'). This poller closes the loop:

  1. Cross-tenant scan of processing rows (like OutboxRelay, it reads EVERY
     tenant's rows so it SET ROLE's to the BYPASSRLS ``sim_relay`` role on the
     scan connection).
  2. For each row, GET the analysis from Revital.
  3. On a terminal status (complete/partial) map completeness → case_criteria
     and triage → case_suggestions, emit AGENT_ASSIST_PRODUCED, and mark the
     row done — all in ONE tenant_transaction.
  4. On a failed status or a poll timeout, emit AGENT_ASSIST_FAILED and mark
     the row done.
  5. A transient Revital error leaves the row processing for the next tick.

INVARIANT: Revital output is advisory only — never used to commit a determination.
NEVER-THROW: the poll loop and _process_one must never throw out, so one bad row
    can never stall the others (mirrors OutboxRelay).
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg

from simintero_outbox import SchemaRef, make_envelope
from simintero_tenant_context import tenant_transaction

from enstellar_connectors.revital.client import RevitalClient
from enstellar_connectors.revital.models import AnalysisResult

from ..cases.repository import CaseRepository
from ..config import get_settings
from ..criteria.repository import CriteriaRepository
from ..outbox.publisher import OutboxPublisher, lob_for_envelope
from ..suggestions.repository import SuggestionsRepository
from .inflight_repository import InflightRepository
from .mapping import map_completeness_to_criteria, map_triage_to_suggestion

logger = logging.getLogger(__name__)

_TERMINAL_OK = {"complete", "partial"}


class RevitalPoller:
    """Polls revital_inflight and finalizes terminal/timed-out analyses."""

    def __init__(
        self, pool: asyncpg.Pool, revital: RevitalClient | None = None
    ) -> None:
        self._pool = pool
        self._revital = revital or RevitalClient()
        self._inflight = InflightRepository()
        self._criteria = CriteriaRepository()
        self._suggestions = SuggestionsRepository()
        self._cases = CaseRepository()
        self._outbox = OutboxPublisher()
        self._running = False

    async def start(self) -> None:
        self._running = True
        settings = get_settings()
        while self._running:
            try:
                processed = await self._poll_batch()
                if processed == 0:
                    await asyncio.sleep(settings.revital_poll_interval_seconds)
            except Exception:
                logger.exception("RevitalPoller error — retrying after sleep")
                await asyncio.sleep(settings.revital_poll_interval_seconds)

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
        """Scan processing rows (cross-tenant), then process each one.

        The scan happens inside its own short transaction on the sim_relay conn;
        per-row work runs OUTSIDE that connection (its own tenant_transaction).
        """
        async with self._scan_conn() as conn:
            async with conn.transaction():
                rows = await self._inflight.list_processing(conn)

        for row in rows:
            await self._process_one(row)
        return len(rows)

    async def _process_one(self, row: dict) -> None:
        """Handle a single in-flight row. NEVER raises out of this method."""
        try:
            result = await self._revital.get_analysis(
                row["analysis_id"], row["tenant_id"]
            )
        except Exception as exc:  # transient: leave processing for the next tick
            logger.warning(
                "revital_poll_get_failed",
                extra={
                    "tenant_id": row["tenant_id"],
                    "analysis_id": row["analysis_id"],
                    "error": str(exc)[:400],
                },
            )
            return

        try:
            if result.status == "processing":
                age = (
                    datetime.now(timezone.utc) - row["submitted_at"]
                ).total_seconds()
                if age > get_settings().revital_poll_timeout_seconds:
                    await self._finish_failed(row, "timeout")
                return
            if result.status in _TERMINAL_OK:
                await self._finish_ok(row, result)
            else:
                await self._finish_failed(row, f"revital_status_{result.status}")
        except Exception:  # never let a write failure stall the loop
            logger.exception(
                "revital_poll_finalize_failed",
                extra={
                    "tenant_id": row["tenant_id"],
                    "analysis_id": row["analysis_id"],
                },
            )

    async def _finish_ok(self, row: dict, result: AnalysisResult) -> None:
        """Map result → rows + AGENT_ASSIST_PRODUCED, all in ONE tenant_transaction."""
        case_id = row["case_id"]
        tenant_id = row["tenant_id"]
        criteria_rows = map_completeness_to_criteria(
            result, case_id=case_id, tenant_id=tenant_id
        )
        suggestion_rows = map_triage_to_suggestion(
            result, case_id=case_id, tenant_id=tenant_id
        )
        confidence = result.triage.confidence if result.triage else None

        async with tenant_transaction(self._pool, tenant_id) as conn:
            if not await self._inflight.claim(conn, row["analysis_id"]):
                logger.info(
                    "revital_finalize_skipped_already_done",
                    extra={
                        "analysis_id": row["analysis_id"],
                        "tenant_id": tenant_id,
                    },
                )
                return
            case = await self._cases.fetch_by_id(conn, case_id, tenant_id)
            lob = lob_for_envelope(case.lob) if case else None
            event = make_envelope(
                SchemaRef.AGENT_ASSIST_PRODUCED,
                tenant_id=tenant_id,
                actor_id="revital",
                actor_type="service",
                correlation_id=row["correlation_id"],
                lob=lob,
                payload={
                    "case_id": str(case_id),
                    "agent_id": "revital",
                    "confidence": confidence,
                    "citations": [],
                },
            )
            if criteria_rows:
                await self._criteria.insert_many(conn, criteria_rows)
            if suggestion_rows:
                await self._suggestions.insert_many(conn, suggestion_rows)
            await self._outbox.publish(conn, event)

        logger.info(
            "revital_poll_finalized",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(case_id),
                "analysis_id": row["analysis_id"],
                "criteria_count": len(criteria_rows),
                "suggestion_count": len(suggestion_rows),
            },
        )

    async def _finish_failed(self, row: dict, reason: str) -> None:
        """Emit AGENT_ASSIST_FAILED + mark_done in ONE tenant_transaction."""
        case_id = row["case_id"]
        tenant_id = row["tenant_id"]

        async with tenant_transaction(self._pool, tenant_id) as conn:
            if not await self._inflight.claim(conn, row["analysis_id"]):
                logger.info(
                    "revital_finalize_skipped_already_done",
                    extra={
                        "analysis_id": row["analysis_id"],
                        "tenant_id": tenant_id,
                    },
                )
                return
            case = await self._cases.fetch_by_id(conn, case_id, tenant_id)
            lob = lob_for_envelope(case.lob) if case else None
            event = make_envelope(
                SchemaRef.AGENT_ASSIST_FAILED,
                tenant_id=tenant_id,
                actor_id="revital",
                actor_type="service",
                correlation_id=row["correlation_id"],
                lob=lob,
                payload={
                    "case_id": str(case_id),
                    "agent_id": "revital",
                    "reason": reason,
                },
            )
            await self._outbox.publish(conn, event)

        logger.info(
            "revital_poll_failed",
            extra={
                "tenant_id": tenant_id,
                "case_id": str(case_id),
                "analysis_id": row["analysis_id"],
                "reason": reason,
            },
        )
