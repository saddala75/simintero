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
from fastapi import FastAPI

from enstellar_authz import JWTValidator, validate_jwt_config
from enstellar_connectors.digicore.client import DigiCoreClient
from enstellar_workflow.api.router import router as cases_router
from enstellar_workflow.api.worklist_router import router as worklist_router
from enstellar_workflow.config import get_settings
from enstellar_workflow.consumers import AutoDeterminationConsumer, ClinicalReviewConsumer
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

    # --- Auth ---
    if settings.jwks_uri and settings.oidc_issuer:
        jwt_validator = JWTValidator(
            jwks_uri=settings.jwks_uri,
            issuer=settings.oidc_issuer,
            audience=settings.expected_audience,
        )
        validate_jwt_config(jwt_validator)  # fails fast if audience not configured
        app.state.jwt_validator = jwt_validator
        logger.info("JWT validator configured (issuer=%s)", settings.oidc_issuer)
    else:
        logger.warning(
            "WORKFLOW_JWKS_URI / WORKFLOW_OIDC_ISSUER not set — "
            "JWT validation is disabled; set these in production"
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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
