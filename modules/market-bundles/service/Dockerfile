# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/market-bundles/service/package.json ./modules/market-bundles/service/

RUN pnpm install --frozen-lockfile --filter @sim/market-bundles...

COPY modules/market-bundles/service/ ./modules/market-bundles/service/
RUN pnpm --filter @sim/market-bundles run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/market-bundles/service/dist ./dist
COPY --from=builder /repo/modules/market-bundles/service/node_modules ./node_modules
COPY --from=builder /repo/modules/market-bundles/service/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3018
EXPOSE 3018

CMD ["node", "dist/index.js"]
