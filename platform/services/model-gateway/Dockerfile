# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/model-gateway/package.json ./platform/services/model-gateway/

RUN pnpm install --frozen-lockfile --filter @sim/model-gateway...

COPY platform/services/model-gateway/ ./platform/services/model-gateway/
RUN pnpm --filter @sim/model-gateway run build
RUN pnpm --filter @sim/model-gateway deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/model-gateway/dist ./dist

ENV NODE_ENV=production
ENV PORT=3011
EXPOSE 3011

CMD ["node", "dist/index.js"]
