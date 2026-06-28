#!/usr/bin/env bash
# platform-down.sh — shut down the Simintero unified stack.
#
# Usage:
#   ./scripts/platform-down.sh          # stop containers, KEEP volumes (data survives)
#   ./scripts/platform-down.sh --clean  # stop + delete all volumes (full reset)
#   ./scripts/platform-down.sh --clean --images  # also delete built images (full wipe)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CLEAN=false
REMOVE_IMAGES=false
for arg in "$@"; do
  case "$arg" in
    --clean)  CLEAN=true ;;
    --images) REMOVE_IMAGES=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ "$CLEAN" = true ]; then
  echo "── Stopping and removing all containers + volumes (full reset) ──"
  echo "   This deletes all Postgres data, Kafka offsets, MinIO blobs, and Keycloak sessions."
  docker compose down -v --remove-orphans
  if [ "$REMOVE_IMAGES" = true ]; then
    echo "── Removing all built images ──"
    docker compose down --rmi local 2>/dev/null || true
  fi
  echo "✅ Full clean complete — next start will re-seed all data from scratch"
else
  echo "── Stopping Simintero platform (volumes preserved) ──"
  docker compose down --remove-orphans
  echo "✅ Platform stopped — data volumes intact, next start will be fast"
fi
