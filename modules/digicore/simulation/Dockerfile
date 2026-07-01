# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/digicore/simulation/package.json ./modules/digicore/simulation/
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/package.json ./platform/libs/tenant-context/ts/
RUN pnpm install --frozen-lockfile --filter @sim/digicore-simulation...
COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY modules/digicore/simulation/ ./modules/digicore/simulation/
RUN pnpm --filter @sim/digicore-simulation... run build
RUN pnpm --filter @sim/digicore-simulation deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/digicore/simulation/dist ./dist
COPY artifacts/synthetic/ /artifacts/synthetic/
ENV NODE_ENV=production
ENV PORT=3052
EXPOSE 3052
CMD ["node", "dist/index.js"]
