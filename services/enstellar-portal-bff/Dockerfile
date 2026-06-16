# syntax=docker/dockerfile:1
# Build context = repo root (compose: context: .). portal-bff is a uv workspace
# member depending on simintero-authz; its workspace deps' source must be present.
FROM python:3.12-slim
RUN pip install --no-cache-dir uv && \
    adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY platform/libs/tenant-context/py ./platform/libs/tenant-context/py
COPY platform/libs/authz-client/py ./platform/libs/authz-client/py
COPY services/enstellar-portal-bff ./services/enstellar-portal-bff
RUN uv sync --frozen --no-dev --package enstellar-bff && \
    chown -R appuser:appuser /app
USER appuser
WORKDIR /app/services/enstellar-portal-bff
EXPOSE 8001
CMD ["uv", "run", "--no-sync", "uvicorn", "enstellar_bff.main:app", "--host", "0.0.0.0", "--port", "8001"]
