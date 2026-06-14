"""Enstellar Agent Layer — FastAPI application entry point.

Start with:
    uvicorn enstellar_agents.main:app --host 0.0.0.0 --port 8001 --reload
"""
from __future__ import annotations

import logging
import sys

from fastapi import FastAPI

from enstellar_agents.routers.assist import router as assist_router

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
)

app = FastAPI(
    title="Enstellar Agent Layer",
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.include_router(assist_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
