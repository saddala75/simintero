from fastapi import FastAPI

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


@app.get("/healthz", tags=["ops"])
async def health() -> dict:
    return {"status": "ok"}
