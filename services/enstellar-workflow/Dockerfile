# syntax=docker/dockerfile:1
# Build context MUST be the repo root (compose sets context: ../..) because the
# workflow-engine pyproject path-depends on packages/* and services/integration-connectors.
FROM python:3.12-slim
RUN pip install --no-cache-dir uv && \
    adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY packages /app/packages
COPY services/integration-connectors /app/services/integration-connectors
COPY services/workflow-engine /app/services/workflow-engine
WORKDIR /app/services/workflow-engine
RUN uv sync --frozen --no-dev && \
    chmod +x docker-entrypoint.sh && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
