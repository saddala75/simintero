"""Enstellar Workflow Engine — FastAPI application entry point.

Start with:
    uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

from simintero_authz import AuthError, ForbiddenError
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_workflow.api.router import router as cases_router
from enstellar_workflow.api.worklist_router import router as worklist_router
from enstellar_workflow.appeals.api import router as appeals_router
from enstellar_workflow.grievances.api import router as grievances_router
from enstellar_workflow.directory.api import router as directory_router
from enstellar_workflow.auth import jwt_validator
from enstellar_workflow.config import get_settings
from enstellar_workflow.consumers import (
    AutoDeterminationConsumer,
    ClinicalReviewConsumer,
    RfiResponseConsumer,
)
from enstellar_workflow.kafka.producer import KafkaProducer
from enstellar_workflow.outbox.relay import OutboxRelay
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
from enstellar_workflow.comms.service import NotificationService
from enstellar_workflow.criteria.router import router as criteria_router
from enstellar_workflow.normalization.api import router as normalization_router
from enstellar_workflow.queues.router import router as queues_router
from enstellar_workflow.clocks.sla_poller import SlaPoller
from enstellar_workflow.grievances.sla_poller import GrievanceSlaPoller
from enstellar_workflow.revital.poller import RevitalPoller
from enstellar_workflow.suggestions.router import router as suggestions_router

# ── OpenTelemetry bootstrap ────────────────────────────────────────────────
if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
    _otel_provider = TracerProvider()
    _otel_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter())
    )
    trace.set_tracer_provider(_otel_provider)
    FastAPIInstrumentor().instrument()
    AsyncPGInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # --- Auth (simintero-authz, realm `simintero`) ---
    # The validator + require_auth dependency are constructed in
    # enstellar_workflow.auth at import; expose the validator on app.state.
    app.state.jwt_validator = jwt_validator

    # Fail fast if JWT audience verification is disabled in a non-local deploy.
    # When oidc_audience is None the validator does NOT enforce `aud`, so tokens
    # minted for OTHER simintero-realm services would be accepted. Allow this
    # only for local/test/dev where an audience is commonly unset.
    if not settings.oidc_audience and settings.env not in ("local", "test", "dev"):
        raise RuntimeError(
            "WORKFLOW_OIDC_AUDIENCE (oidc_audience) is not set — JWT audience verification "
            "would be disabled, accepting tokens minted for other simintero-realm services. "
            "Set the expected audience, or run with env=local/test/dev."
        )

    logger.info(
        "JWT validator configured (issuer=%s, opa_url=%s)",
        settings.oidc_issuer,
        settings.opa_url,
    )

    # --- DB pool + consumers ---
    # Convert SQLAlchemy-style URL to plain asyncpg URL if needed.
    db_url = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")

    pool = await asyncpg.create_pool(db_url, min_size=2, max_size=10)

    # --- Second pool: the `simintero` DB (as sim_app), for the fabric bridge ---
    # When SIMINTERO_DB_URL is set, open a pool against the simintero database so
    # later slices can write evidence into fabric.resource. Reachable as
    # `app.state.fabric_pool` (None when SIMINTERO_DB_URL is unset). Normalize any
    # SQLAlchemy-style `+asyncpg` form to a raw postgresql:// DSN for asyncpg.
    fabric_pool: asyncpg.Pool | None = None
    if settings.simintero_db_url:
        fabric_dsn = settings.simintero_db_url.replace(
            "postgresql+asyncpg://", "postgresql://"
        )
        # Small pool: the bridge only does a handful of synchronous evidence upserts per
        # $submit, and the shared Postgres has a default 100-connection ceiling the full
        # stack already pressures — keep this footprint minimal (review finding I1).
        fabric_pool = await asyncpg.create_pool(fabric_dsn, min_size=1, max_size=3)
        logger.info("Fabric (simintero) pool started")
    else:
        logger.info("SIMINTERO_DB_URL unset — fabric pool disabled")
    app.state.fabric_pool = fabric_pool

    digicore = DigiCoreClient()
    auto_consumer = AutoDeterminationConsumer(pool=pool, digicore=digicore)
    consumer_task = asyncio.create_task(auto_consumer.run(), name="auto-determination-consumer")
    logger.info("AutoDeterminationConsumer started")

    clinical_review_consumer = ClinicalReviewConsumer(pool=pool)
    cr_task = asyncio.create_task(clinical_review_consumer.run(), name="clinical-review-consumer")
    logger.info("ClinicalReviewConsumer started")

    rfi_response_consumer = RfiResponseConsumer(pool=pool)
    rfi_task = asyncio.create_task(rfi_response_consumer.run(), name="rfi-response-consumer")
    logger.info("RfiResponseConsumer started")

    producer = KafkaProducer()
    await producer.start()
    relay = OutboxRelay(pool, producer)
    relay_task = asyncio.create_task(relay.start(), name="outbox-relay")
    logger.info("OutboxRelay started")
    decision_consumer = DecisionRecordedConsumer(
        pool=pool, notification_service=NotificationService(OutboxPublisher())
    )
    dr_task = asyncio.create_task(decision_consumer.run(), name="decision-recorded-consumer")
    logger.info("DecisionRecordedConsumer started")

    revital_poller = RevitalPoller(pool)
    rp_task = asyncio.create_task(revital_poller.start(), name="revital-poller")
    logger.info("RevitalPoller started")

    sla_poller = SlaPoller(pool)
    sla_task = asyncio.create_task(sla_poller.start(), name="sla-poller")
    logger.info("SlaPoller started")

    grievance_poller = GrievanceSlaPoller(pool)
    gsp_task = asyncio.create_task(grievance_poller.start(), name="grievance-sla-poller")
    logger.info("GrievanceSlaPoller started")

    try:
        yield
    finally:
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass
        cr_task.cancel()
        try:
            await cr_task
        except asyncio.CancelledError:
            pass
        rfi_task.cancel()
        try:
            await rfi_task
        except asyncio.CancelledError:
            pass
        await relay.stop()
        await revital_poller.stop()
        await sla_poller.stop()
        await grievance_poller.stop()
        for t in (relay_task, dr_task, rp_task, sla_task, gsp_task):
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        # close long-lived httpx clients (consumer + poller) to drain pools
        await clinical_review_consumer._docs.close()
        await clinical_review_consumer._revital.close()
        await revital_poller.aclose()
        await producer.stop()
        await pool.close()
        if fabric_pool is not None:
            await fabric_pool.close()


app = FastAPI(
    title="Enstellar Workflow Engine",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


async def otel_enrich(request: Request, call_next):
    """Stamp tenant_id and user.sub from auth context onto the active OTel span."""
    span = trace.get_current_span()
    response = await call_next(request)
    ctx = getattr(request.state, "tenant_context", None)
    if ctx is not None:
        span.set_attribute("tenant_id", ctx.tenant_id)
        span.set_attribute("user.sub", getattr(ctx, "sub", ""))
    return response


app.middleware("http")(otel_enrich)

app.include_router(normalization_router)
app.include_router(cases_router)
app.include_router(criteria_router)
app.include_router(suggestions_router)
app.include_router(worklist_router)
app.include_router(queues_router)
app.include_router(appeals_router)
app.include_router(grievances_router)
app.include_router(directory_router)


# --- simintero-authz exception → HTTP status mapping -------------------------
# simintero_authz raises plain exceptions (not HTTPException); translate them
# into the canonical 401 / 403 responses.
@app.exception_handler(AuthError)
async def _auth_error_handler(request: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": str(exc) or "Unauthorized"},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(ForbiddenError)
async def _forbidden_handler(request: Request, exc: ForbiddenError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc) or "Forbidden"})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
