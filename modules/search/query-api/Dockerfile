# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/search/query-api/package.json ./modules/search/query-api/

RUN pnpm install --frozen-lockfile --filter @sim/search-query-api...

COPY modules/search/query-api/ ./modules/search/query-api/
RUN pnpm --filter @sim/search-query-api run build

# Produce a self-contained deployment dir with REAL (non-symlinked) node_modules.
# pnpm deploy hoists the workspace deps into /app/deploy/node_modules so the
# runtime image has no dangling pnpm virtual-store symlinks.
RUN pnpm --filter @sim/search-query-api deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/search/query-api/dist ./dist

ENV NODE_ENV=production
ENV PORT=3019
EXPOSE 3019

CMD ["node", "dist/index.js"]
