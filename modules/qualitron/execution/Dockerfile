# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/qualitron/execution/package.json ./modules/qualitron/execution/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-execution...

COPY modules/qualitron/execution/ ./modules/qualitron/execution/
RUN pnpm --filter @sim/qualitron-execution run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/qualitron/execution/dist ./dist
COPY --from=builder /repo/modules/qualitron/execution/node_modules ./node_modules
COPY --from=builder /repo/modules/qualitron/execution/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3015
EXPOSE 3015

CMD ["node", "dist/index.js"]
