from __future__ import annotations

import json
from dataclasses import dataclass

import asyncpg

from ..clocks.model import CLOCK_RULES, ClockDefinition

_DEFAULT_SLA_WARNING_PCT = 75
_DEFAULT_SLA_QUEUE = "md_review"

NOTICE_PARAM_DEFAULTS = {"appeal_deadline_days": 60}


@dataclass
class SlaConfig:
    warning_threshold_pct: int
    escalation_queue: str


class ConfigService:
    """Per-(tenant, lob) operational config lookup, backed by the workflow_config table
    with a fallback to the hardcoded CLOCK_RULES. Stateless — instantiate freely.
    Must be called inside the caller's tenant_transaction (RLS applies)."""

    async def resolve_clock(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        lob: str,
        urgency: str,
        clock_type: str = "decision",
    ) -> ClockDefinition:
        days = await self._lookup_days(conn, tenant_id, lob, urgency, clock_type)
        if days is None:
            days = CLOCK_RULES.get((urgency, clock_type))
        if days is None:
            raise ValueError(
                f"No clock duration for tenant={tenant_id!r} lob={lob!r} "
                f"urgency={urgency!r} clock_type={clock_type!r}"
            )
        return ClockDefinition(
            clock_type=clock_type,
            urgency=urgency,
            duration_calendar_days=int(days),
        )

    async def _lookup_days(self, conn, tenant_id, lob, urgency, clock_type):
        row = await conn.fetchrow(
            "SELECT config FROM workflow_config "
            "WHERE tenant_id=$1 AND lob=$2 AND domain='clocks' AND active",
            tenant_id,
            lob,
        )
        if row is None:
            return None
        config = row["config"]
        if isinstance(config, str):  # asyncpg returns jsonb as str (no codec set)
            config = json.loads(config)
        section = config.get(clock_type)
        if not isinstance(section, dict):
            return None
        return section.get(urgency)

    async def resolve_sla(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        lob: str,
    ) -> SlaConfig:
        row = await conn.fetchrow(
            "SELECT config FROM workflow_config "
            "WHERE tenant_id=$1 AND lob=$2 AND domain='sla' AND active",
            tenant_id,
            lob,
        )
        pct, queue = _DEFAULT_SLA_WARNING_PCT, _DEFAULT_SLA_QUEUE
        if row is not None:
            cfg = row["config"]
            if isinstance(cfg, str):  # asyncpg returns jsonb as str (no codec set)
                cfg = json.loads(cfg)
            if isinstance(cfg, dict):
                pct = int(cfg.get("warning_threshold_pct", pct))
                queue = str(cfg.get("escalation_queue", queue))
        return SlaConfig(warning_threshold_pct=pct, escalation_queue=queue)

    async def resolve_notice_params(
        self,
        conn: asyncpg.Connection,
        *,
        tenant_id: str,
        lob: str | None,
    ) -> dict:
        """Per-(tenant, lob) notice params (table→default fallback). ALWAYS returns a
        full dict (every key present) so StrictUndefined templates never raise."""
        params = dict(NOTICE_PARAM_DEFAULTS)
        if lob is None:
            return params
        row = await conn.fetchrow(
            "SELECT config FROM workflow_config "
            "WHERE tenant_id=$1 AND lob=$2 AND domain='notifications' AND active",
            tenant_id,
            lob,
        )
        if row is not None:
            cfg = row["config"]
            if isinstance(cfg, str):  # asyncpg returns jsonb as str (no codec set)
                cfg = json.loads(cfg)
            if isinstance(cfg, dict):
                params.update(cfg)
        return params
