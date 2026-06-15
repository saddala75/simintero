# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN pip install --no-cache-dir uv && \
    adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY enstellar_bff ./enstellar_bff
RUN uv sync --frozen --no-dev && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8001
CMD ["uv", "run", "--no-sync", "uvicorn", "enstellar_bff.main:app", "--host", "0.0.0.0", "--port", "8001"]
