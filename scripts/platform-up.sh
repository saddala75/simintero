#!/usr/bin/env bash
# platform-up.sh — bring the Simintero unified stack up and wait for all services to be healthy.
#
# Usage:
#   ./scripts/platform-up.sh          # start everything, wait for healthy
#   ./scripts/platform-up.sh --build  # rebuild all Docker images first, then start
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BUILD=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ── Prerequisites check ──────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "❌ Docker daemon not running. Start Docker Desktop." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ Docker Compose v2 not found. Bundled with Docker Desktop 4.x+; on Linux install the docker-compose-plugin package." >&2; exit 1; }

# Warn if ANTHROPIC_API_KEY is unset (AI features degraded, smoke still passes via mock-llm)
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "⚠️  ANTHROPIC_API_KEY is not set — AI features will use mock-llm (smoke passes, real inference won't work)"
fi

# ── Build (optional) ─────────────────────────────────────────────────────────
if [ "$BUILD" = true ]; then
  echo "── Building all Docker images ──"
  docker compose build
fi

# ── Bring up the stack ───────────────────────────────────────────────────────
echo "── Starting Simintero platform ──"
echo "   This may take 3-10 minutes on first run (images pull + HAPI loads IGs)."
echo "   Subsequent starts take ~60-90 seconds."

# otel-collector healthcheck can transiently fail under load; tolerate its exit code.
docker compose up -d 2>&1 || true

# ── Wait for health ──────────────────────────────────────────────────────────
# Services without a healthcheck are treated as healthy (empty status = ok).
CORE_SVCS="postgres keycloak redpanda minio opa mailpit
  digicore-runtime document-service document-worker
  interop workflow-engine portal-bff
  temporal revital-pipeline revital-worker model-gateway
  vkas mock-llm digicore-authoring digicore-governance qualitron task-service terminology-service relay
  otel-collector"

wait_healthy() {
  local label="$1" max_wait="${2:-450}"
  echo "  Waiting for services to be healthy (timeout ${max_wait}s)..."
  for svc in $CORE_SVCS; do
    local container="simintero-${svc}-1"
    local elapsed=0
    while [ "$elapsed" -lt "$max_wait" ]; do
      local hs st
      hs=$(docker inspect "$container" --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
      st=$(docker inspect "$container" --format='{{.State.Status}}' 2>/dev/null || echo "missing")
      if [ "$st" = "missing" ]; then
        echo "   ⚠️  $svc container not found (may not be in compose profile)" >&2
        break
      fi
      if [ "$st" != "running" ] && [ "$st" != "created" ]; then
        echo "❌ $svc is $st (not running). Check: docker logs simintero-${svc}-1" >&2
        exit 1
      fi
      [ "$hs" = "healthy" ] || [ -z "$hs" ] && break
      sleep 5
      elapsed=$((elapsed + 5))
    done
    hs=$(docker inspect "$container" --format='{{.State.Health.Status}}' 2>/dev/null || echo "")
    if [ "$hs" != "healthy" ] && [ -n "$hs" ]; then
      echo "❌ $svc still $hs after ${max_wait}s. Check: docker logs simintero-${svc}-1" >&2
      exit 1
    fi
  done
  echo "  ✅ Core services healthy"
}

wait_healthy "core"

# ── HAPI FHIR ────────────────────────────────────────────────────────────────
# interop does not start until HAPI is healthy (Docker depends_on), so it won't appear
# in the CORE_SVCS check above on first boot. Poll HAPI directly (port 8090).
# First boot: up to 15 min while HAPI loads IGs. Subsequent starts: ~60s.
echo "  Waiting for HAPI FHIR (first boot: up to 15 min; port 8090)..."
HAPI_READY=false
for i in $(seq 1 180); do
  if curl -sf http://localhost:8090/fhir/metadata >/dev/null 2>&1; then
    HAPI_READY=true
    break
  fi
  [ $((i % 12)) -eq 0 ] && echo "   still waiting for HAPI (${i}×5s)..."
  sleep 5
done
if [ "$HAPI_READY" = false ]; then
  echo "❌ HAPI not ready after 15 min. Check: docker logs simintero-hapi-1" >&2
  echo "   If exit code is 137 (SIGKILL), Docker is OOM — increase memory to 8 GB." >&2
  exit 1
fi
echo "  ✅ HAPI FHIR ready"

# Wait for interop (which starts after HAPI) and any other late-starting services.
wait_healthy "late"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "✅ Simintero platform is up"
echo ""
echo "  Portal UI          http://localhost:5173"
echo "  Portal BFF API     http://localhost:8001/docs"
echo "  Interop FHIR       http://localhost:8080/fhir/metadata"
echo "  HAPI FHIR (raw)    http://localhost:8090/fhir/metadata"
echo "  Keycloak admin     http://localhost:8081  (admin / admin)"
echo "  Grafana            http://localhost:3000"
echo "  Temporal UI        http://localhost:8088"
echo "  MinIO console      http://localhost:9001  (minioadmin / minioadmin)"
echo "  Mailpit (email)    http://localhost:8025"
echo ""
echo "  Test login: username=md-reviewer  password=e2e-pass"
echo ""
echo "  Run the smoke test:  make smoke"
echo "  Shut down:           make down"
