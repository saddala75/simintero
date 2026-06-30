# ── Stage 1: build ──
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/relay/package.json ./platform/services/relay/
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
RUN pnpm install --frozen-lockfile --filter @sim/relay...
COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY platform/services/relay/ ./platform/services/relay/
RUN pnpm --filter @sim/relay... run build
RUN pnpm --filter @sim/relay deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ──
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/relay/dist ./dist
ENV NODE_ENV=production
ENV PORT=3070
EXPOSE 3070
CMD ["node", "dist/index.js"]
