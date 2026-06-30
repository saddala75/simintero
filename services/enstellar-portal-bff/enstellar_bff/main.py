import os

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from simintero_authz import AuthError, ForbiddenError

from enstellar_bff.routers import appeals, cases, directory, grievances, worklist
from enstellar_bff.routers.crd import router as crd_router
from enstellar_bff.routers.dtr import router as dtr_router
from enstellar_bff.routers.measure_library import router as measure_library_router
from enstellar_bff.routers.admin_dlq import router as admin_dlq_router
from enstellar_bff.routers.queues import router as queues_router
from enstellar_bff.routers.dashboard import router as dashboard_router
from enstellar_bff.routers.revital import router as revital_router

# ── OpenTelemetry bootstrap ────────────────────────────────────────────────
if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
    _otel_provider = TracerProvider()
    _otel_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter())
    )
    trace.set_tracer_provider(_otel_provider)
    FastAPIInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()

app = FastAPI(title="Enstellar BFF", version="0.1.0")


async def otel_enrich(request: Request, call_next):
    """Stamp tenant_id and user.sub from BFF auth context onto the active OTel span."""
    span = trace.get_current_span()
    response = await call_next(request)
    ctx = getattr(request.state, "bff_context", None)
    if ctx is not None:
        span.set_attribute("tenant_id", ctx.tenant_id)
        span.set_attribute("user.sub", getattr(ctx, "sub", ""))
    return response


app.middleware("http")(otel_enrich)

app.include_router(worklist.router, prefix="/bff")
app.include_router(cases.router, prefix="/bff")
app.include_router(appeals.router, prefix="/bff")
app.include_router(grievances.router, prefix="/bff")
app.include_router(directory.router, prefix="/bff")
app.include_router(queues_router)
app.include_router(crd_router)
app.include_router(dtr_router)
app.include_router(dashboard_router)
app.include_router(revital_router)
app.include_router(measure_library_router)
app.include_router(admin_dlq_router)


@app.exception_handler(AuthError)
async def _auth_error_handler(_: Request, exc: AuthError) -> JSONResponse:
    """simintero-authz AuthError (identity validation failed) → 401."""
    return JSONResponse(status_code=401, content={"detail": str(exc)})


@app.exception_handler(ForbiddenError)
async def _forbidden_error_handler(_: Request, exc: ForbiddenError) -> JSONResponse:
    """simintero-authz ForbiddenError (authorization denied) → 403."""
    return JSONResponse(
        status_code=getattr(exc, "status", 403), content={"detail": str(exc)}
    )


@app.exception_handler(httpx.HTTPStatusError)
async def _upstream_status(
    request: Request, exc: httpx.HTTPStatusError
) -> JSONResponse:
    """Workflow-engine error status bubbled up by a route → propagate it.

    Keeps the BFF a thin pass-through: a 4xx from the engine (403/404/409/422)
    reaches the client as the same status + detail. An engine 5xx is remapped to
    502 Bad Gateway — the upstream is broken, not the BFF, and a passthrough 500
    would be indistinguishable from a BFF-side crash (matches the local catches in
    cases.py/dtr.py/crd.py)."""
    resp = exc.response
    if resp.status_code >= 500:
        return JSONResponse(status_code=502, content={"detail": "Upstream error"})
    try:
        detail = resp.json().get("detail", resp.text)
    except Exception:
        detail = resp.text
    return JSONResponse(status_code=resp.status_code, content={"detail": detail})


@app.get("/healthz", tags=["ops"])
async def health() -> dict:
    return {"status": "ok"}
