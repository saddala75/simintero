"""Enstellar Workflow Engine — FastAPI application entry point.

Start with:
    uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from simintero_authz import AuthError, ForbiddenError
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_workflow.api.router import router as cases_router
from enstellar_workflow.api.worklist_router import router as worklist_router
from enstellar_workflow.auth import jwt_validator
from enstellar_workflow.config import get_settings
from enstellar_workflow.consumers import AutoDeterminationConsumer, ClinicalReviewConsumer
from enstellar_workflow.kafka.producer import KafkaProducer
from enstellar_workflow.outbox.relay import OutboxRelay
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
from enstellar_workflow.comms.service import NotificationService
from enstellar_workflow.criteria.router import router as criteria_router
from enstellar_workflow.normalization.api import router as normalization_router
from enstellar_workflow.queues.router import router as queues_router
from enstellar_workflow.suggestions.router import router as suggestions_router

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
    digicore = DigiCoreClient()
    auto_consumer = AutoDeterminationConsumer(pool=pool, digicore=digicore)
    consumer_task = asyncio.create_task(auto_consumer.run(), name="auto-determination-consumer")
    logger.info("AutoDeterminationConsumer started")

    clinical_review_consumer = ClinicalReviewConsumer(pool=pool)
    cr_task = asyncio.create_task(clinical_review_consumer.run(), name="clinical-review-consumer")
    logger.info("ClinicalReviewConsumer started")

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
        await relay.stop()
        for t in (relay_task, dr_task):
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
        await producer.stop()
        await pool.close()


app = FastAPI(
    title="Enstellar Workflow Engine",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.include_router(normalization_router)
app.include_router(cases_router)
app.include_router(criteria_router)
app.include_router(suggestions_router)
app.include_router(worklist_router)
app.include_router(queues_router)


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
