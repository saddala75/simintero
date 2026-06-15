#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$REPO_ROOT/.dev-pids"

# ── Stop Python / Node services ────────────────────────────────────────────────

if [[ -f "$PID_FILE" ]]; then
  read -r WF_PID BFF_PID WEB_PID < "$PID_FILE"

  for pid in "$WF_PID" "$BFF_PID" "$WEB_PID"; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "→ Stopping PID $pid…"
      kill "$pid"
    fi
  done

  # Wait up to 10 s for processes to exit, then force-kill any stragglers.
  for _ in $(seq 1 10); do
    all_gone=true
    for pid in "$WF_PID" "$BFF_PID" "$WEB_PID"; do
      kill -0 "$pid" 2>/dev/null && all_gone=false
    done
    $all_gone && break
    sleep 1
  done

  for pid in "$WF_PID" "$BFF_PID" "$WEB_PID"; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "→ Force-killing PID $pid…"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  rm -f "$PID_FILE"
else
  echo "No .dev-pids file found — nothing to stop."
fi

# ── Stop Docker infrastructure ─────────────────────────────────────────────────

echo "→ Stopping infrastructure (Docker)…"
make -C "$REPO_ROOT" down

echo "Done."
