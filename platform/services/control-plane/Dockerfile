# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Package manifests for control-plane and its workspace lib deps
COPY platform/services/control-plane/package.json       ./platform/services/control-plane/
COPY platform/libs/otel/package.json                    ./platform/libs/otel/
COPY platform/libs/tenant-context/ts/package.json       ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/package.json               ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/package.json         ./platform/libs/authz-client/ts/
COPY integration/connectors/keycloak/package.json       ./integration/connectors/keycloak/

RUN pnpm install --frozen-lockfile --filter @sim/control-plane...

# Source for all packages needed at compile time
COPY platform/services/control-plane/     ./platform/services/control-plane/
COPY platform/libs/otel/                  ./platform/libs/otel/
COPY platform/libs/tenant-context/ts/     ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/             ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/       ./platform/libs/authz-client/ts/
COPY integration/connectors/keycloak/     ./integration/connectors/keycloak/

# Build workspace libs first
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/tenant-context-ts run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/authz-client-ts run build
RUN pnpm --filter @sim/connector-keycloak run build

# Build the service
RUN pnpm --filter @sim/control-plane run build

# Self-contained production bundle
RUN pnpm --filter @sim/control-plane deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3012
EXPOSE 3012

CMD ["node", "dist/index.js"]
