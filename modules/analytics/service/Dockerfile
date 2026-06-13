# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/analytics/service/package.json ./modules/analytics/service/

RUN pnpm install --frozen-lockfile --filter @sim/analytics-service...

COPY modules/analytics/service/ ./modules/analytics/service/
RUN pnpm --filter @sim/analytics-service run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/analytics/service/dist ./dist
COPY --from=builder /repo/modules/analytics/service/node_modules ./node_modules
COPY --from=builder /repo/modules/analytics/service/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3020
EXPOSE 3020

CMD ["node", "dist/index.js"]
