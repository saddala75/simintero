# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY modules/market-bundles/service/package.json ./modules/market-bundles/service/

RUN pnpm install --frozen-lockfile --filter @sim/market-bundles...

COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY modules/market-bundles/service/ ./modules/market-bundles/service/
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/market-bundles run build
RUN pnpm --filter @sim/market-bundles deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/market-bundles/service/dist ./dist

ENV NODE_ENV=production
ENV PORT=3018
EXPOSE 3018

CMD ["node", "dist/index.js"]
