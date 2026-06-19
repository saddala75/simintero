# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/digicore/authoring/package.json ./modules/digicore/authoring/
# Workspace lib deps (@sim/outbox-ts, @sim/tenant-context-ts) — manifests for install
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/package.json ./platform/libs/tenant-context/ts/
RUN pnpm install --frozen-lockfile --filter @sim/digicore-authoring...
# Workspace lib deps source — needed to compile their dist/ for runtime resolution
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY modules/digicore/authoring/ ./modules/digicore/authoring/
# Build deps (...) so @sim/outbox-ts + @sim/tenant-context-ts dist/ exist for deploy
RUN pnpm --filter @sim/digicore-authoring... run build
RUN pnpm --filter @sim/digicore-authoring deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/digicore/authoring/dist ./dist
ENV NODE_ENV=production
ENV PORT=3052
EXPOSE 3052
CMD ["node", "dist/index.js"]
