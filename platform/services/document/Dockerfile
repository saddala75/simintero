# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/document/package.json ./platform/services/document/
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/

RUN pnpm install --frozen-lockfile --filter @sim/document...

COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/services/document/ ./platform/services/document/

# Build workspace libs first, then the service
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/document run build

# Produce a self-contained deployment dir with REAL (non-symlinked) node_modules.
# pnpm deploy hoists the workspace deps into /app/deploy/node_modules so the
# runtime image has no dangling pnpm virtual-store symlinks.
RUN pnpm --filter @sim/document deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/document/dist ./dist

ENV NODE_ENV=production
ENV PORT=3010
EXPOSE 3010

CMD ["node", "dist/index.js"]
