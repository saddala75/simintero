"""enstellar-poller — standalone single-instance service for background SLA polling.

Scans running decision clocks across all tenants and triggers escalations / warnings,
polls Revital AI review status, and monitors grievance SLAs.
Must be deployed with replicas=1 to prevent N-way redundant DB polling.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from enstellar_workflow.clocks.sla_poller import SlaPoller
from enstellar_workflow.config import get_settings
from enstellar_workflow.grievances.sla_poller import GrievanceSlaPoller
from enstellar_workflow.revital.poller import RevitalPoller

logger = logging.getLogger("enstellar-poller")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    db_url = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")

    logger.info("Connecting to DB for enstellar-poller...")
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5)
    app.state.pool = pool

    revital_poller = RevitalPoller(pool)
    rp_task = asyncio.create_task(revital_poller.start(), name="poller-revital")

    sla_poller = SlaPoller(pool)
    sla_task = asyncio.create_task(sla_poller.start(), name="poller-sla")

    grievance_poller = GrievanceSlaPoller(pool)
    gsp_task = asyncio.create_task(grievance_poller.start(), name="poller-grievance-sla")

    logger.info("enstellar-poller started successfully with all background pollers")

    try:
        yield
    finally:
        logger.info("Stopping enstellar-poller...")
        await revital_poller.stop()
        await sla_poller.stop()
        await grievance_poller.stop()
        for t in (rp_task, sla_task, gsp_task):
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        await revital_poller.aclose()
        await pool.close()
        logger.info("enstellar-poller stopped cleanly")


app = FastAPI(
    title="Enstellar SLA Poller Service",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "enstellar-poller"}


@app.get("/ready", include_in_schema=False)
async def readiness(request: Request) -> JSONResponse:
    checks = {}
    status = 200
    try:
        pool = getattr(request.app.state, "pool", None)
        if pool is None:
            raise RuntimeError("pool not initialized")
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = "unreachable"
        status = 503

    checks["status"] = "ready" if status == 200 else "degraded"
    return JSONResponse(content=checks, status_code=status)
