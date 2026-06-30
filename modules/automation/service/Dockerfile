# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

# Copy root workspace config + shared tsconfig
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy package.json files first for better layer caching on install
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY modules/automation/service/package.json ./modules/automation/service/

RUN pnpm install --frozen-lockfile --filter @sim/automation-service...

# Copy full source (dist excluded by .dockerignore — build from source below)
COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY modules/automation/service/ ./modules/automation/service/

# Build workspace libs first, then the service
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/automation-service run build
RUN pnpm --filter @sim/automation-service deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/automation/service/dist ./dist

ENV NODE_ENV=production
ENV PORT=3017
EXPOSE 3017

CMD ["node", "dist/index.js"]
