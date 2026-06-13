# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY modules/enstellar/comms/package.json          ./modules/enstellar/comms/
COPY platform/libs/tenant-context/ts/package.json  ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/package.json          ./platform/libs/outbox/ts/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-comms...

COPY modules/enstellar/comms/         ./modules/enstellar/comms/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/         ./platform/libs/outbox/ts/

# Build workspace libs first
RUN pnpm --filter @sim/tenant-context-ts run build
RUN pnpm --filter @sim/outbox-ts run build

# Build the service
RUN pnpm --filter @sim/enstellar-comms run build

# Self-contained production bundle
RUN pnpm --filter @sim/enstellar-comms deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3022
EXPOSE 3022

CMD ["node", "dist/index.js"]
