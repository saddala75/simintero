import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from simintero_authz import AuthError, ForbiddenError

from enstellar_bff.routers import appeals, cases, directory, grievances, worklist
from enstellar_bff.routers.crd import router as crd_router
from enstellar_bff.routers.dtr import router as dtr_router
from enstellar_bff.routers.queues import router as queues_router

app = FastAPI(title="Enstellar BFF", version="0.1.0")
app.include_router(worklist.router, prefix="/bff")
app.include_router(cases.router, prefix="/bff")
app.include_router(appeals.router, prefix="/bff")
app.include_router(grievances.router, prefix="/bff")
app.include_router(directory.router, prefix="/bff")
app.include_router(queues_router)
app.include_router(crd_router)
app.include_router(dtr_router)


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
