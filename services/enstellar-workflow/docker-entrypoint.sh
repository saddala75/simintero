#!/usr/bin/env sh
set -e
echo "Running Alembic migrations..."
# Alembic's migrations/env.py uses a SYNCHRONOUS SQLAlchemy engine (psycopg2),
# but the app reads WORKFLOW_DB_URL as an async (+asyncpg) URL. Strip the
# +asyncpg driver suffix for the migration step only; the app keeps the async URL.
ALEMBIC_DB_URL=$(printf '%s' "$WORKFLOW_DB_URL" | sed 's/+asyncpg//')
# --no-sync: use the venv baked at image build (uv sync --frozen --no-dev). Without it,
# `uv run` re-syncs from PyPI at container start, breaking offline/reproducible bring-up.
WORKFLOW_DB_URL="$ALEMBIC_DB_URL" uv run --no-sync alembic upgrade head
echo "Starting workflow-engine..."
exec uv run --no-sync uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000
