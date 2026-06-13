#!/usr/bin/env bash
# Generates a Dockerfile for each Node.js service.
# Usage: bash scripts/build-all-dockerfiles.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

generate() {
  local SERVICE_PATH="$1"
  local PACKAGE_NAME="$2"
  local PORT="$3"
  local ENTRY="${4:-dist/index.js}"

  local dest="$REPO_ROOT/$SERVICE_PATH/Dockerfile"
  if [[ -f "$dest" ]]; then
    echo "SKIP $dest (already exists)"
    return
  fi

  cat > "$dest" <<DOCKERFILE
# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ${SERVICE_PATH}/package.json ./${SERVICE_PATH}/

RUN pnpm install --frozen-lockfile --filter ${PACKAGE_NAME}...

COPY ${SERVICE_PATH}/ ./${SERVICE_PATH}/
RUN pnpm --filter ${PACKAGE_NAME} run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/${SERVICE_PATH}/dist ./dist
COPY --from=builder /repo/${SERVICE_PATH}/node_modules ./node_modules
COPY --from=builder /repo/${SERVICE_PATH}/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD ["node", "${ENTRY}"]
DOCKERFILE

  echo "CREATED $dest"
}

# ── Node HTTP services ───────────────────────────────────────────────────────
generate "platform/services/document"        "@sim/document"                    3010
generate "platform/services/model-gateway"   "@sim/model-gateway"               3011
generate "platform/services/control-plane"   "@sim/control-plane"               3012
generate "modules/enstellar/case"            "@sim/enstellar-case"              3013
generate "modules/enstellar/comms"           "@sim/enstellar-comms"             3022
generate "modules/enstellar/workspace-bff"   "@sim/enstellar-workspace-bff"     3021
generate "modules/revital/pipeline"          "@sim/revital-pipeline"            3014
generate "modules/qualitron/execution"       "@sim/qualitron-execution"         3015
generate "modules/claims/service"            "@sim/claims-service"              3016
generate "modules/automation/service"        "@sim/automation-service"          3017
generate "modules/market-bundles/service"    "@sim/market-bundles"              3018
generate "modules/search/query-api"          "@sim/search-query-api"            3019
generate "modules/analytics/service"         "@sim/analytics-service"           3020

echo "Done. Run: git add -p to review generated Dockerfiles."
