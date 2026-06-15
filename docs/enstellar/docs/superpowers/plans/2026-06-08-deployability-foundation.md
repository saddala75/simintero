# Deployability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize every first-party Enstellar service (interop JVM, workflow-engine, agent-layer, portal-bff, web) and wire them into `infra/compose/docker-compose.yml` so `make up` brings the entire *real* stack healthy on a single VM — no service running on the host.

**Architecture:** Each service gets a multi-stage `Dockerfile` and a compose service entry on the existing `enstellar-local` default network. Services reach each other by service-name DNS. interop reuses the `hapi` Postgres DB and proxies FHIR to the `hapi` container (`HAPI_PROXY_ENABLED=true`); workflow-engine runs Alembic on start and uses `workflow-db`; web is built to static assets and served by nginx that reverse-proxies `/bff` to portal-bff. Config is via env with `${VAR:-default}` and a documented `.env.example`.

**Tech Stack:** Docker (multi-stage), docker compose, Gradle 8.7 / Java 21 / Spring Boot (interop), Python 3.12 + `uv` (Python services), Node 22 + Vite + nginx (web).

**Verification model:** This is infrastructure, so each task's "test" is a build + run + health/smoke check (exact commands + expected output given), not a unit test. Keep commits small (one service per task).

**Key facts (do not re-derive):**
- Compose file: `infra/compose/docker-compose.yml`, `name: enstellar-local`, default network, service-DNS. Makefile `up:` = `docker compose -f infra/compose/docker-compose.yml up -d --build --wait`; `down:` = `... down -v`.
- Existing internal DNS/ports: `hapi:8080` (FHIR, `expose` only), `hapi-db:5432` (db `hapi`/user `hapi`/pw `${HAPI_DB_PASSWORD:-hapi_secret}`), `workflow-db:5432` (db `workflow`/user `workflow`/pw `${WORKFLOW_DB_PASSWORD:-workflow_secret}`; also hosts a `keycloak` db), `redpanda:29092` (internal Kafka), `minio:9000`, `keycloak:8080` (internal; host `${KEYCLOAK_PORT:-8081}`), `ollama:11434`, `mock-digicore:8000`, `mock-revital:8000`.
- interop: Spring Boot, `./gradlew bootJar` → `build/libs/interop-0.1.0.jar`; main `com.simintero.enstellar.interop.InteropApplication`; port 8080; **no actuator** → health probe = `GET /fhir/metadata` (permitAll, 200). `settings.gradle.kts` has `includeBuild("../../packages/canonical-model")` and subproject `x12-translator`, so the Docker build context must include `packages/canonical-model`. Flyway self-migrates at boot against its datasource (defaults to the `hapi` DB).
- Python services use `uv` (`uv.lock` + `pyproject.toml`, py3.12). workflow-engine path-deps: `packages/event-contracts`, `packages/canonical-model`, `packages/authz`, and sibling `services/integration-connectors` → its build context must be the repo root. agent-layer and portal-bff have **no** internal package deps (self-contained context).
- App modules / ports / health: workflow-engine `enstellar_workflow.main:app` :8000 `/health`; agent-layer `enstellar_agents.main:app` :8000 `/healthz`; portal-bff `enstellar_bff.main:app` :8001 `/healthz`.
- web: Vite build → `dist/`; API base is the hardcoded relative path `/bff` (no env var) → nginx must reverse-proxy `/bff` to `portal-bff:8001`. Keycloak realm `enstellar-app` client already allows redirect `http://localhost:5173/*`, so publish web on host 5173.
- Config env keys (service → key → in-compose value):
  - interop: `INTEROP_DB_URL=jdbc:postgresql://hapi-db:5432/hapi`, `INTEROP_DB_USER=hapi`, `INTEROP_DB_PASSWORD=${HAPI_DB_PASSWORD:-hapi_secret}`, `HAPI_BASE_URL=http://hapi:8080/fhir`, `HAPI_PROXY_ENABLED=true`, `KAFKA_BOOTSTRAP_SERVERS=redpanda:29092`, `MINIO_ENDPOINT=minio:9000`, `MINIO_ACCESS_KEY=minioadmin`, `MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD:-minioadmin}`, `MINIO_BUCKET=enstellar-raw-bundles`, `NORMALIZATION_URL=http://workflow-engine:8000`, `KEYCLOAK_ISSUER_URI=http://keycloak:8080/realms/enstellar`, `KEYCLOAK_JWK_SET_URI=http://keycloak:8080/realms/enstellar/protocol/openid-connect/certs`, `EXPECTED_AUDIENCE=enstellar-api`.
  - workflow-engine: `WORKFLOW_DB_URL=postgresql+asyncpg://workflow:${WORKFLOW_DB_PASSWORD:-workflow_secret}@workflow-db:5432/workflow`, `WORKFLOW_KAFKA_BOOTSTRAP_SERVERS=redpanda:29092`, `WORKFLOW_AGENT_LAYER_URL=http://agent-layer:8000`, `MINIO_ENDPOINT=minio:9000`, `MINIO_ACCESS_KEY=minioadmin`, `MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD:-minioadmin}`, `MINIO_BUCKET=enstellar-raw-bundles`, `DIGICORE_BASE_URL=http://mock-digicore:8000`, `REVITAL_BASE_URL=http://mock-revital:8000`.
  - agent-layer: `ENSTELLAR_MODEL_PROVIDER=ollama`, `ENSTELLAR_OLLAMA_BASE_URL=http://ollama:11434` (Anthropic optional via `ENSTELLAR_ANTHROPIC_API_KEY`).
  - portal-bff: `BFF_WORKFLOW_ENGINE_URL=http://workflow-engine:8000`, `BFF_FHIR_API_URL=http://interop:8080/fhir`, `BFF_KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/enstellar/protocol/openid-connect/certs` (override the wrong `8180` default).

---

## Task 1: Containerize and wire `interop` (JVM)

**Files:**
- Create: `services/interop/Dockerfile`
- Create: `services/interop/.dockerignore`
- Modify: `infra/compose/docker-compose.yml` (add `interop` service)

- [ ] **Step 1: Write `services/interop/.dockerignore`**

Keep the build context lean but DO NOT exclude `packages/canonical-model` generated sources or gradle build inputs.

```
build/
.gradle/
**/build/
**/.gradle/
*.iml
.idea/
```

- [ ] **Step 2: Write `services/interop/Dockerfile` (multi-stage, build context = repo root)**

```dockerfile
# syntax=docker/dockerfile:1
# Build context MUST be the repo root (compose sets context: ../..) because
# settings.gradle.kts does includeBuild("../../packages/canonical-model").
FROM gradle:8.7-jdk21 AS build
WORKDIR /src
COPY packages/canonical-model /src/packages/canonical-model
COPY services/interop /src/services/interop
WORKDIR /src/services/interop
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN useradd -r -u 1001 -m appuser
COPY --from=build /src/services/interop/build/libs/interop-0.1.0.jar /app/app.jar
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

- [ ] **Step 3: Add the `interop` service to `infra/compose/docker-compose.yml`**

Insert after the `hapi:` service block. Reuses the existing mounted `healthcheck.jar` (interop has no actuator; probe `/fhir/metadata`).

```yaml
  interop:
    build:
      context: ../..
      dockerfile: services/interop/Dockerfile
    expose:
      - "8080"
    depends_on:
      hapi-db:
        condition: service_healthy
      hapi:
        condition: service_healthy
      redpanda:
        condition: service_healthy
      minio:
        condition: service_healthy
      keycloak:
        condition: service_healthy
    environment:
      INTEROP_DB_URL: jdbc:postgresql://hapi-db:5432/hapi
      INTEROP_DB_USER: hapi
      INTEROP_DB_PASSWORD: ${HAPI_DB_PASSWORD:-hapi_secret}
      HAPI_BASE_URL: http://hapi:8080/fhir
      HAPI_PROXY_ENABLED: "true"
      KAFKA_BOOTSTRAP_SERVERS: redpanda:29092
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-minioadmin}
      MINIO_SECURE: "false"
      MINIO_BUCKET: enstellar-raw-bundles
      NORMALIZATION_URL: http://workflow-engine:8000
      KEYCLOAK_ISSUER_URI: http://keycloak:8080/realms/enstellar
      KEYCLOAK_JWK_SET_URI: http://keycloak:8080/realms/enstellar/protocol/openid-connect/certs
      EXPECTED_AUDIENCE: enstellar-api
    volumes:
      - ./healthcheck/healthcheck.jar:/healthcheck.jar:ro
    healthcheck:
      test: ["CMD", "java", "-jar", "/healthcheck.jar", "http://localhost:8080/fhir/metadata"]
      interval: 30s
      timeout: 15s
      retries: 10
      start_period: 120s
```

- [ ] **Step 4: Build and run interop in compose, verify healthy**

Run:
```bash
docker compose -f infra/compose/docker-compose.yml up -d --build interop
```
Then wait and check health:
```bash
docker compose -f infra/compose/docker-compose.yml ps interop
```
Expected: `interop` reaches `(healthy)` within ~2 min (it pulls up `hapi`/`hapi-db` as deps). If it fails, inspect: `docker compose -f infra/compose/docker-compose.yml logs interop | tail -50`.

Common failure + fix: if the Gradle stage fails resolving `canonical-model`, confirm `.dockerignore` did not exclude `packages/canonical-model` generated sources; if Flyway fails, confirm `hapi-db` is healthy and the `hapi` DB exists (it is created by the `hapi-db` container's `POSTGRES_DB=hapi`).

- [ ] **Step 5: Smoke-test the FHIR endpoint through interop**

Run (from inside the compose network to avoid host-port exposure):
```bash
docker compose -f infra/compose/docker-compose.yml exec -T interop \
  java -jar /healthcheck.jar http://localhost:8080/fhir/metadata && echo "OK"
```
Expected: prints `OK` (exit 0 = HTTP 200 CapabilityStatement proxied from HAPI).

- [ ] **Step 6: Commit**

```bash
git add services/interop/Dockerfile services/interop/.dockerignore infra/compose/docker-compose.yml
git commit -m "feat(deploy): containerize interop + wire into compose (proxy to HAPI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Containerize and wire `agent-layer`

**Files:**
- Create: `services/agent-layer/Dockerfile`
- Create: `services/agent-layer/.dockerignore`
- Modify: `infra/compose/docker-compose.yml` (add `agent-layer` service)

- [ ] **Step 1: Write `services/agent-layer/.dockerignore`**

```
.venv/
__pycache__/
**/__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mypy_cache/
```

- [ ] **Step 2: Write `services/agent-layer/Dockerfile` (self-contained context)**

Binds port 8000 (workflow-engine reaches it at `http://agent-layer:8000`).

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY enstellar_agents ./enstellar_agents
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "enstellar_agents.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Add the `agent-layer` service to `infra/compose/docker-compose.yml`**

```yaml
  agent-layer:
    build:
      context: ../../services/agent-layer
      dockerfile: Dockerfile
    expose:
      - "8000"
    environment:
      ENSTELLAR_MODEL_PROVIDER: ${ENSTELLAR_MODEL_PROVIDER:-ollama}
      ENSTELLAR_MODEL_NAME: ${ENSTELLAR_MODEL_NAME:-llama3}
      ENSTELLAR_OLLAMA_BASE_URL: http://ollama:11434
      ENSTELLAR_ANTHROPIC_API_KEY: ${ENSTELLAR_ANTHROPIC_API_KEY:-}
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
```

- [ ] **Step 4: Build, run, verify healthy**

Run:
```bash
docker compose -f infra/compose/docker-compose.yml up -d --build agent-layer
docker compose -f infra/compose/docker-compose.yml ps agent-layer
```
Expected: `agent-layer` reaches `(healthy)` (startup is lazy w.r.t. the model, so it should come up without Ollama having a model pulled).

- [ ] **Step 5: Commit**

```bash
git add services/agent-layer/Dockerfile services/agent-layer/.dockerignore infra/compose/docker-compose.yml
git commit -m "feat(deploy): containerize agent-layer + wire into compose

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Containerize and wire `workflow-engine` (with Alembic on start)

**Files:**
- Create: `services/workflow-engine/Dockerfile`
- Create: `services/workflow-engine/.dockerignore`
- Create: `services/workflow-engine/docker-entrypoint.sh`
- Modify: `infra/compose/docker-compose.yml` (add `workflow-engine` service)

- [ ] **Step 1: Write `services/workflow-engine/.dockerignore`**

```
.venv/
__pycache__/
**/__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mypy_cache/
```

- [ ] **Step 2: Write `services/workflow-engine/docker-entrypoint.sh`**

Runs migrations before serving (interop self-migrates via Flyway; workflow-engine uses Alembic and must migrate first).

```bash
#!/usr/bin/env sh
set -e
echo "Running Alembic migrations..."
uv run alembic upgrade head
echo "Starting workflow-engine..."
exec uv run uvicorn enstellar_workflow.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 3: Write `services/workflow-engine/Dockerfile` (build context = repo root)**

Mirrors the monorepo layout so `uv`'s editable path deps resolve (`../../packages/*` and `../integration-connectors`).

```dockerfile
# syntax=docker/dockerfile:1
# Build context MUST be the repo root (compose sets context: ../..) because the
# workflow-engine pyproject path-depends on packages/* and services/integration-connectors.
FROM python:3.12-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY packages /app/packages
COPY services/integration-connectors /app/services/integration-connectors
COPY services/workflow-engine /app/services/workflow-engine
WORKDIR /app/services/workflow-engine
RUN uv sync --frozen --no-dev
RUN chmod +x docker-entrypoint.sh
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 4: Add the `workflow-engine` service to `infra/compose/docker-compose.yml`**

```yaml
  workflow-engine:
    build:
      context: ../..
      dockerfile: services/workflow-engine/Dockerfile
    expose:
      - "8000"
    depends_on:
      workflow-db:
        condition: service_healthy
      redpanda:
        condition: service_healthy
      minio:
        condition: service_healthy
      agent-layer:
        condition: service_healthy
    environment:
      WORKFLOW_DB_URL: postgresql+asyncpg://workflow:${WORKFLOW_DB_PASSWORD:-workflow_secret}@workflow-db:5432/workflow
      WORKFLOW_KAFKA_BOOTSTRAP_SERVERS: redpanda:29092
      WORKFLOW_AGENT_LAYER_URL: http://agent-layer:8000
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-minioadmin}
      MINIO_SECURE: "false"
      MINIO_BUCKET: enstellar-raw-bundles
      DIGICORE_BASE_URL: http://mock-digicore:8000
      REVITAL_BASE_URL: http://mock-revital:8000
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 40s
```

- [ ] **Step 5: Build, run, verify healthy (migrations apply)**

Run:
```bash
docker compose -f infra/compose/docker-compose.yml up -d --build workflow-engine
docker compose -f infra/compose/docker-compose.yml logs workflow-engine | grep -i "alembic\|Running migrations\|Starting workflow"
docker compose -f infra/compose/docker-compose.yml ps workflow-engine
```
Expected: logs show Alembic upgrade then uvicorn start; service reaches `(healthy)`. If the asyncpg pool or Kafka consumer fails at boot, confirm `workflow-db` and `redpanda` are healthy.

- [ ] **Step 6: Commit**

```bash
git add services/workflow-engine/Dockerfile services/workflow-engine/.dockerignore services/workflow-engine/docker-entrypoint.sh infra/compose/docker-compose.yml
git commit -m "feat(deploy): containerize workflow-engine (alembic on start) + wire into compose

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Containerize and wire `portal-bff`

**Files:**
- Create: `services/portal-bff/Dockerfile`
- Create: `services/portal-bff/.dockerignore`
- Modify: `infra/compose/docker-compose.yml` (add `portal-bff` service)

- [ ] **Step 1: Write `services/portal-bff/.dockerignore`**

```
.venv/
__pycache__/
**/__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mypy_cache/
```

- [ ] **Step 2: Write `services/portal-bff/Dockerfile` (self-contained context, port 8001)**

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY enstellar_bff ./enstellar_bff
RUN uv sync --frozen --no-dev
EXPOSE 8001
CMD ["uv", "run", "uvicorn", "enstellar_bff.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

- [ ] **Step 3: Add the `portal-bff` service to `infra/compose/docker-compose.yml`**

`BFF_KEYCLOAK_JWKS_URL` overrides the wrong `:8180` default. Real auth stays on (no dev bypass) for the hosted pilot.

```yaml
  portal-bff:
    build:
      context: ../../services/portal-bff
      dockerfile: Dockerfile
    expose:
      - "8001"
    depends_on:
      workflow-engine:
        condition: service_healthy
      interop:
        condition: service_healthy
      keycloak:
        condition: service_healthy
    environment:
      BFF_WORKFLOW_ENGINE_URL: http://workflow-engine:8000
      BFF_FHIR_API_URL: http://interop:8080/fhir
      BFF_KEYCLOAK_JWKS_URL: http://keycloak:8080/realms/enstellar/protocol/openid-connect/certs
      BFF_DEV_BYPASS_AUTH: ${BFF_DEV_BYPASS_AUTH:-false}
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/healthz')"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 30s
```

- [ ] **Step 4: Build, run, verify healthy**

```bash
docker compose -f infra/compose/docker-compose.yml up -d --build portal-bff
docker compose -f infra/compose/docker-compose.yml ps portal-bff
```
Expected: `portal-bff` reaches `(healthy)` (pulls up its deps interop/workflow-engine/keycloak).

- [ ] **Step 5: Commit**

```bash
git add services/portal-bff/Dockerfile services/portal-bff/.dockerignore infra/compose/docker-compose.yml
git commit -m "feat(deploy): containerize portal-bff + wire into compose

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Containerize and wire `web` (nginx serving built assets + `/bff` proxy)

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`
- Create: `apps/web/.dockerignore`
- Modify: `infra/compose/docker-compose.yml` (add `web` service)

- [ ] **Step 1: Write `apps/web/.dockerignore`**

```
node_modules/
dist/
.vite/
playwright-report/
test-results/
```

- [ ] **Step 2: Write `apps/web/nginx.conf`**

Serves the SPA and reverse-proxies the hardcoded `/bff` path to portal-bff (the app has no API-base env var; `src/api/client.ts` uses `BASE = '/bff'`).

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # API calls (client.ts uses relative base '/bff') -> portal-bff
    location /bff/ {
        proxy_pass http://portal-bff:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA history-mode fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Write `apps/web/Dockerfile` (Node build → nginx runtime)**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 4: Add the `web` service to `infra/compose/docker-compose.yml`**

Published on host 5173 (already an allowed Keycloak redirect origin).

```yaml
  web:
    build:
      context: ../../apps/web
      dockerfile: Dockerfile
    ports:
      - "${WEB_PORT:-5173}:80"
    depends_on:
      portal-bff:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost/"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s
```

- [ ] **Step 5: Build, run, verify the SPA serves and `/bff` proxies**

```bash
docker compose -f infra/compose/docker-compose.yml up -d --build web
docker compose -f infra/compose/docker-compose.yml ps web
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```
Expected: `web` `(healthy)`; `curl` prints `200` (SPA index). Then verify the proxy path reaches the BFF (a 401/200 — anything but a connection error — proves wiring):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/bff/queues
```
Expected: `200` or `401` (NOT `502`/`000`). A `502` means the proxy can't reach `portal-bff` — recheck the upstream name/port.

- [ ] **Step 6: Commit**

```bash
git add apps/web/Dockerfile apps/web/nginx.conf apps/web/.dockerignore infra/compose/docker-compose.yml
git commit -m "feat(deploy): containerize web (nginx + /bff proxy) + wire into compose

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full-stack bring-up, `.env.example`, runbook, and DoD verification

**Files:**
- Modify: `infra/compose/.env.example`
- Create: `infra/compose/SMOKE.md` (one-command bring-up + smoke runbook)
- Modify: `Makefile` (add a `smoke` target)

- [ ] **Step 1: Add new env vars to `infra/compose/.env.example`**

Append (keep existing entries):

```bash
# --- First-party app tier (deployability foundation) ---
# Web UI host port (Keycloak realm allows redirect to http://localhost:5173/*)
WEB_PORT=5173
# Agent model provider: "ollama" (default, local) or "anthropic"
ENSTELLAR_MODEL_PROVIDER=ollama
ENSTELLAR_MODEL_NAME=llama3
# Required only when ENSTELLAR_MODEL_PROVIDER=anthropic
ENSTELLAR_ANTHROPIC_API_KEY=
# Set to "true" ONLY for local debugging; MUST be false for a hosted pilot
BFF_DEV_BYPASS_AUTH=false
```

- [ ] **Step 2: Add a `smoke` target to the `Makefile`**

Insert near the `conformance`/`e2e` targets:

```makefile
## Smoke-test the running stack (run after `make up`).
smoke:
	@echo "→ interop /fhir/metadata"; \
	  $(COMPOSE) exec -T interop java -jar /healthcheck.jar http://localhost:8080/fhir/metadata && echo "  interop OK"
	@echo "→ workflow-engine /health"; \
	  $(COMPOSE) exec -T workflow-engine python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" && echo "  workflow OK"
	@echo "→ portal-bff /healthz"; \
	  $(COMPOSE) exec -T portal-bff python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/healthz')" && echo "  bff OK"
	@echo "→ web /"; \
	  curl -fsS -o /dev/null http://localhost:$${WEB_PORT:-5173}/ && echo "  web OK"
	@echo "✓ Smoke passed"
```

- [ ] **Step 3: Write `infra/compose/SMOKE.md` (runbook)**

```markdown
# Local / pilot bring-up

Prereqs: Docker + docker compose on the host/VM.

1. `cp infra/compose/.env.example infra/compose/.env` and edit secrets.
2. From the repo root: `make up`  (builds all images and waits for healthchecks)
3. `make smoke`  (verifies interop, workflow-engine, portal-bff, web)
4. Open the UI: http://localhost:5173

Services (all containerized; none run on the host):
- web (nginx) → portal-bff → { workflow-engine, interop }
- interop (FHIR proxy) → hapi (+ hapi-db); writes to redpanda/minio
- workflow-engine → workflow-db, redpanda, minio, agent-layer, mock connectors

Tear down (removes volumes): `make down`
```

- [ ] **Step 4: Clean-bring-up verification (the DoD)**

Run from a clean state:
```bash
make down
make up
```
Expected: `make up` exits 0 with every service `(healthy)` — including `interop`, `agent-layer`, `workflow-engine`, `portal-bff`, `web` (compose `--wait` blocks until healthchecks pass). Then:
```bash
make smoke
```
Expected: prints `interop OK`, `workflow OK`, `bff OK`, `web OK`, `✓ Smoke passed`.

Confirm nothing runs on the host:
```bash
docker compose -f infra/compose/docker-compose.yml ps --format '{{.Service}} {{.State}}'
```
Expected: all first-party services listed as `running`.

- [ ] **Step 5: Commit**

```bash
git add infra/compose/.env.example infra/compose/SMOKE.md Makefile
git commit -m "feat(deploy): full-stack make up + smoke target + bring-up runbook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer / known risks

- **Build context size:** interop and workflow-engine build from the repo root; rely on each service's `.dockerignore` to keep context lean. If `docker build` is slow pulling huge context, verify `.dockerignore` excludes `build/`, `.gradle/`, `.venv/`, `node_modules/`.
- **canonical-model generation:** the interop Gradle composite build expects `packages/canonical-model` to be buildable in the container. If its Java sources are code-generated by a separate (non-Gradle) step, ensure the generated sources are committed/copied (don't `.dockerignore` them). If the Gradle build can't produce them, the fix belongs in this task — surface it rather than working around it.
- **`uv sync --frozen`:** requires `uv.lock` to be current. If a lock is stale the build fails fast; regenerate with `uv lock` on the host and commit, don't drop `--frozen`.
- **agent-layer / Ollama:** the container comes up healthy without a pulled model (calls are lazy). Pulling a model and real agent eval is sub-project #7, out of scope here.
- **Auth for the smoke:** `/bff/queues` may return 401 without a token — that still proves proxy wiring. A full Keycloak login flow is exercised in the end-to-end sub-project (#6). Keep `BFF_DEV_BYPASS_AUTH=false` for the hosted pilot.
- **Do not** change `interop.hapi.proxy-enabled`'s default in `application.yml` here (that production-default decision is deferred to the conformance sub-project #4); this plan sets `HAPI_PROXY_ENABLED=true` via the compose env only.
- **Invariants:** no app logic changes in this sub-project — it is packaging + wiring only. Keep PHI out of logs and don't add any cross-boundary path.
```
