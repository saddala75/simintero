# services/qualitron-reporting/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/qualitron/reporting/package.json ./modules/qualitron/reporting/
COPY services/qualitron-reporting/package.json ./services/qualitron-reporting/
COPY platform/libs/otel/package.json ./platform/libs/otel/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-reporting-service...

COPY modules/qualitron/reporting/ ./modules/qualitron/reporting/
COPY services/qualitron-reporting/ ./services/qualitron-reporting/
COPY platform/libs/otel/ ./platform/libs/otel/

# Build workspace libs first
RUN pnpm --filter @sim/otel run build

# Build the reporting library
RUN pnpm --filter @sim/qualitron-reporting run build

# Build the service
RUN pnpm --filter @sim/qualitron-reporting-service run build

# Self-contained production bundle
RUN pnpm --filter @sim/qualitron-reporting-service deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=4080
EXPOSE 4080

CMD ["node", "dist/server.js"]
