# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/digicore/registry/package.json ./modules/digicore/registry/
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/package.json ./platform/libs/tenant-context/ts/
RUN pnpm install --frozen-lockfile --filter @sim/digicore-registry...
COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY modules/digicore/registry/ ./modules/digicore/registry/
RUN pnpm --filter @sim/digicore-registry... run build
RUN pnpm --filter @sim/digicore-registry deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/digicore/registry/dist ./dist
ENV NODE_ENV=production
ENV PORT=3010
EXPOSE 3010
CMD ["node", "dist/server.js"]
