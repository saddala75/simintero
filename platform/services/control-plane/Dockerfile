# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY platform/services/control-plane/package.json ./platform/services/control-plane/

RUN pnpm install --frozen-lockfile --filter @sim/control-plane...

COPY platform/services/control-plane/ ./platform/services/control-plane/
RUN pnpm --filter @sim/control-plane run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/platform/services/control-plane/dist ./dist
COPY --from=builder /repo/platform/services/control-plane/node_modules ./node_modules
COPY --from=builder /repo/platform/services/control-plane/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3012
EXPOSE 3012

CMD ["node", "dist/index.js"]
