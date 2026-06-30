# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY modules/analytics/service/package.json ./modules/analytics/service/

RUN pnpm install --frozen-lockfile --filter @sim/analytics-service...

COPY platform/libs/otel/ ./platform/libs/otel/
COPY modules/analytics/service/ ./modules/analytics/service/
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/analytics-service run build
RUN pnpm --filter @sim/analytics-service deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/analytics/service/dist ./dist

ENV NODE_ENV=production
ENV PORT=3020
EXPOSE 3020

CMD ["node", "dist/index.js"]
