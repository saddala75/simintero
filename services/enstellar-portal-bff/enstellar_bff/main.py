from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from simintero_authz import AuthError, ForbiddenError

from enstellar_bff.routers import cases, worklist
from enstellar_bff.routers.crd import router as crd_router
from enstellar_bff.routers.dtr import router as dtr_router
from enstellar_bff.routers.queues import router as queues_router

app = FastAPI(title="Enstellar BFF", version="0.1.0")
app.include_router(worklist.router, prefix="/bff")
app.include_router(cases.router, prefix="/bff")
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


@app.get("/healthz", tags=["ops"])
async def health() -> dict:
    return {"status": "ok"}
