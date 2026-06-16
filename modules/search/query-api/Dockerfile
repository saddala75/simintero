# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/search/query-api/package.json ./modules/search/query-api/

RUN pnpm install --frozen-lockfile --filter @sim/search-query-api...

COPY modules/search/query-api/ ./modules/search/query-api/
RUN pnpm --filter @sim/search-query-api run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/search/query-api/dist ./dist
COPY --from=builder /repo/modules/search/query-api/node_modules ./node_modules
COPY --from=builder /repo/modules/search/query-api/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3019
EXPOSE 3019

CMD ["node", "dist/index.js"]
