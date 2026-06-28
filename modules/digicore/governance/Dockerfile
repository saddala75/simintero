# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/digicore/governance/package.json ./modules/digicore/governance/
# Workspace lib deps — manifests for install
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/package.json ./platform/libs/tenant-context/ts/
COPY platform/libs/otel/package.json ./platform/libs/otel/
RUN pnpm install --frozen-lockfile --filter @sim/digicore-governance...
# Workspace lib deps source — needed to compile their dist/ for runtime resolution
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY platform/libs/otel/ ./platform/libs/otel/
COPY modules/digicore/governance/ ./modules/digicore/governance/
# Build deps (...) so @sim/outbox-ts + @sim/tenant-context-ts dist/ exist for deploy
RUN pnpm --filter @sim/digicore-governance... run build
RUN pnpm --filter @sim/digicore-governance deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/digicore/governance/dist ./dist
ENV NODE_ENV=production
ENV PORT=3053
EXPOSE 3053
CMD ["node", "dist/index.js"]
