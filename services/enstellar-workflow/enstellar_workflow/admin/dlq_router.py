"""DLQ admin endpoints — list and reprocess dead-lettered outbox events (P2.8).

Uses SET LOCAL ROLE sim_relay (BYPASSRLS) so admin can see events across all tenants.
Gated by the saas_admin JWT role.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from ..auth import AdminRequest
from ..db.connection import get_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/dlq", tags=["admin"])

_RELAY_ROLE = "sim_relay"


@router.get("/outbox")
async def list_outbox_dlq(
    auth: AdminRequest,
) -> dict[str, Any]:
    """List up to 100 dead-lettered outbox events (all tenants)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            rows = await conn.fetch(
                """
                SELECT event_id, topic, tenant_id,
                       dlq_at, dlq_reason, retry_count
                FROM shared.outbox
                WHERE dlq_at IS NOT NULL
                ORDER BY dlq_at DESC
                LIMIT 100
                """
            )
    return {
        "events": [
            {
                "event_id": str(r["event_id"]),
                "topic": r["topic"],
                "tenant_id": r["tenant_id"],
                "dlq_at": r["dlq_at"].isoformat() if r["dlq_at"] else None,
                "dlq_reason": r["dlq_reason"],
                "retry_count": r["retry_count"],
            }
            for r in rows
        ]
    }


@router.get("/consumers")
async def list_consumer_dlq(
    auth: AdminRequest,
) -> dict[str, Any]:
    """List up to 100 entries from shared.consumer_dlq (all tenants)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            rows = await conn.fetch(
                """
                SELECT event_id, consumer_group, topic,
                       error, failed_at, replayed_at
                FROM shared.consumer_dlq
                ORDER BY failed_at DESC
                LIMIT 100
                """
            )
    return {
        "events": [
            {
                "event_id": str(r["event_id"]),
                "consumer_group": r["consumer_group"],
                "topic": r["topic"],
                "error": r["error"],
                "failed_at": r["failed_at"].isoformat() if r["failed_at"] else None,
                "replayed_at": r["replayed_at"].isoformat() if r["replayed_at"] else None,
            }
            for r in rows
        ]
    }


@router.post("/outbox/{event_id}/reprocess")
async def reprocess_outbox_event(
    event_id: str,
    auth: AdminRequest,
) -> dict[str, Any]:
    """Reset a DLQ'd outbox event so the relay picks it up again."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(f'SET LOCAL ROLE "{_RELAY_ROLE}"')
            result = await conn.execute(
                """
                UPDATE shared.outbox
                SET dlq_at = NULL,
                    dlq_reason = NULL,
                    retry_count = 0,
                    published_at = NULL
                WHERE event_id = $1
                  AND dlq_at IS NOT NULL
                """,
                event_id,
            )
    updated = int(result.split()[-1])
    if updated == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Event {event_id} not found in outbox DLQ",
        )
    logger.info("dlq_reprocess event_id=%s actor=%s", event_id, auth.tenant_id)
    return {"requeued": True, "event_id": event_id}
