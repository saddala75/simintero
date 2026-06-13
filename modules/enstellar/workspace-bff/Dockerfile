# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

# Root manifests and shared tsconfig
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Package manifests for workspace-bff and its workspace lib deps
COPY modules/enstellar/workspace-bff/package.json ./modules/enstellar/workspace-bff/
COPY platform/libs/tenant-context/ts/package.json ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/package.json         ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/package.json   ./platform/libs/authz-client/ts/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-workspace-bff...

# Source for workspace-bff and all workspace libs needed at compile time
COPY modules/enstellar/workspace-bff/ ./modules/enstellar/workspace-bff/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/         ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/   ./platform/libs/authz-client/ts/

# Build workspace libs first (exports now point to dist/*.js, not src/*.ts)
RUN pnpm --filter @sim/tenant-context-ts run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/authz-client-ts run build

# Build the service
RUN pnpm --filter @sim/enstellar-workspace-bff run build
# tsc doesn't copy non-.ts assets; schema.graphql is read from dist/ at runtime
RUN cp modules/enstellar/workspace-bff/src/schema.graphql modules/enstellar/workspace-bff/dist/schema.graphql

# Self-contained production bundle — no pnpm symlinks, workspace libs resolved to real dirs
RUN pnpm --filter @sim/enstellar-workspace-bff deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3021
EXPOSE 3021

CMD ["node", "dist/index.js"]
