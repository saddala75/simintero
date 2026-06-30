# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY platform/libs/otel/package.json ./platform/libs/otel/
COPY platform/libs/outbox/ts/package.json ./platform/libs/outbox/ts/
COPY modules/claims/service/package.json              ./modules/claims/service/
COPY integration/connectors/clearinghouse/package.json ./integration/connectors/clearinghouse/

RUN pnpm install --frozen-lockfile --filter @sim/claims-service...

COPY platform/libs/otel/ ./platform/libs/otel/
COPY platform/libs/outbox/ts/ ./platform/libs/outbox/ts/
COPY modules/claims/service/                ./modules/claims/service/
COPY integration/connectors/clearinghouse/  ./integration/connectors/clearinghouse/

# Build workspace libs first
RUN pnpm --filter @sim/otel run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/connector-clearinghouse run build

# Build the service
RUN pnpm --filter @sim/claims-service run build

# Self-contained production bundle
RUN pnpm --filter @sim/claims-service deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3016
EXPOSE 3016

CMD ["node", "dist/index.js"]
