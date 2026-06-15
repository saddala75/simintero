#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"
PID_FILE="$REPO_ROOT/.dev-pids"

mkdir -p "$LOG_DIR"

# ── Helpers ────────────────────────────────────────────────────────────────────

wait_for() {
  local name="$1" url="$2" tries=30
  printf "  waiting for %s" "$name"
  for _ in $(seq 1 $tries); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo " ✓"
      return 0
    fi
    printf "."
    sleep 1
  done
  echo " ✗"
  echo "ERROR: $name did not become healthy at $url" >&2
  exit 1
}

# ── 1. Infrastructure ──────────────────────────────────────────────────────────

echo "→ Starting infrastructure (Docker)…"
make -C "$REPO_ROOT" up

# ── 2. Migrations ──────────────────────────────────────────────────────────────

echo "→ Running Alembic migrations…"
make -C "$REPO_ROOT" migrate

# ── 3. Workflow engine ─────────────────────────────────────────────────────────

echo "→ Starting workflow-engine on :8000…"
(
  cd "$REPO_ROOT/services/workflow-engine"
  uv run uvicorn enstellar_workflow.main:app \
    --host 0.0.0.0 --port 8000 --reload
) > "$LOG_DIR/workflow-engine.log" 2>&1 &
WF_PID=$!

wait_for "workflow-engine" "http://localhost:8000/health"

# ── 4. BFF ─────────────────────────────────────────────────────────────────────

echo "→ Starting BFF on :8001 (dev auth bypass on)…"
(
  cd "$REPO_ROOT/services/portal-bff"
  BFF_WORKFLOW_ENGINE_URL=http://localhost:8000 \
  BFF_DEV_BYPASS_AUTH=1 \
  uv run uvicorn enstellar_bff.main:app \
    --host 0.0.0.0 --port 8001 --reload
) > "$LOG_DIR/bff.log" 2>&1 &
BFF_PID=$!

wait_for "bff" "http://localhost:8001/healthz"

# ── 5. Vite dev server ─────────────────────────────────────────────────────────

echo "→ Starting Vite on :5173…"
(
  cd "$REPO_ROOT/apps/web"
  npm run dev
) > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

wait_for "vite" "http://localhost:5173"

# ── Save PIDs ──────────────────────────────────────────────────────────────────

printf "%s %s %s\n" "$WF_PID" "$BFF_PID" "$WEB_PID" > "$PID_FILE"

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "All services running."
echo ""
echo "  UI:              http://localhost:5173"
echo "  BFF (OpenAPI):   http://localhost:8001/docs"
echo "  Workflow engine: http://localhost:8000/docs"
echo ""
echo "Logs (tail -f):"
echo "  $LOG_DIR/workflow-engine.log"
echo "  $LOG_DIR/bff.log"
echo "  $LOG_DIR/web.log"
echo ""
echo "Run ./stop.sh to tear everything down."
