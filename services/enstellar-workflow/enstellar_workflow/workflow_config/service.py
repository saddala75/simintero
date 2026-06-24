from __future__ import annotations

import json

import asyncpg

from ..clocks.model import CLOCK_RULES, ClockDefinition


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
