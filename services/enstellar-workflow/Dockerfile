# syntax=docker/dockerfile:1
# Build context = repo root (compose: context: .). workflow-engine is a uv
# workspace member; its workspace deps' SOURCE must be present to `uv sync`.
FROM python:3.12-slim
RUN pip install --no-cache-dir uv && \
    adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY contracts ./contracts
COPY platform/libs/tenant-context/py ./platform/libs/tenant-context/py
COPY platform/libs/outbox/py ./platform/libs/outbox/py
COPY platform/libs/authz-client/py ./platform/libs/authz-client/py
COPY services/enstellar-connectors ./services/enstellar-connectors
COPY services/enstellar-workflow ./services/enstellar-workflow
RUN uv sync --frozen --no-dev --package enstellar-workflow && \
    chmod +x services/enstellar-workflow/docker-entrypoint.sh && \
    chown -R appuser:appuser /app
USER appuser
WORKDIR /app/services/enstellar-workflow
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
