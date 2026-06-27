# services/qualitron-aggregation/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/qualitron/aggregation/package.json ./modules/qualitron/aggregation/
COPY services/qualitron-aggregation/package.json ./services/qualitron-aggregation/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-aggregation-service...

COPY modules/qualitron/aggregation/ ./modules/qualitron/aggregation/
COPY services/qualitron-aggregation/ ./services/qualitron-aggregation/

# Build workspace lib first
RUN pnpm --filter @sim/qualitron-aggregation run build

# Build the service
RUN pnpm --filter @sim/qualitron-aggregation-service run build

# Self-contained production bundle
RUN pnpm --filter @sim/qualitron-aggregation-service deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=4081
EXPOSE 4081

CMD ["node", "dist/server.js"]
