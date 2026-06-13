# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY modules/enstellar/case/package.json           ./modules/enstellar/case/
COPY platform/libs/tenant-context/ts/package.json  ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/package.json          ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/package.json    ./platform/libs/authz-client/ts/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-case...

COPY modules/enstellar/case/          ./modules/enstellar/case/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/         ./platform/libs/outbox/ts/
COPY platform/libs/authz-client/ts/   ./platform/libs/authz-client/ts/

# Build workspace libs first
RUN pnpm --filter @sim/tenant-context-ts run build
RUN pnpm --filter @sim/outbox-ts run build
RUN pnpm --filter @sim/authz-client-ts run build

# Build the service
RUN pnpm --filter @sim/enstellar-case run build

# Self-contained production bundle
RUN pnpm --filter @sim/enstellar-case deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3013
EXPOSE 3013

CMD ["node", "dist/index.js"]
