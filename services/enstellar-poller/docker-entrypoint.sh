#!/usr/bin/env bash
set -e
exec uv run uvicorn enstellar_poller.main:app --host 0.0.0.0 --port 8002
