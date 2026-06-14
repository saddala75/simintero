# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN pip install --no-cache-dir uv && \
    adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY enstellar_agents ./enstellar_agents
RUN uv sync --frozen --no-dev && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "enstellar_agents.main:app", "--host", "0.0.0.0", "--port", "8000"]
