FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY modules/enstellar/workflow/package.json       ./modules/enstellar/workflow/
COPY platform/libs/tenant-context/ts/package.json  ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/package.json          ./platform/libs/outbox/ts/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-workflow...

COPY modules/enstellar/workflow/      ./modules/enstellar/workflow/
COPY platform/libs/tenant-context/ts/ ./platform/libs/tenant-context/ts/
COPY platform/libs/outbox/ts/         ./platform/libs/outbox/ts/

# Build workspace libs first
RUN pnpm --filter @sim/tenant-context-ts run build
RUN pnpm --filter @sim/outbox-ts run build

# Build the service
RUN pnpm --filter @sim/enstellar-workflow run build

# Self-contained production bundle
RUN pnpm --filter @sim/enstellar-workflow deploy --legacy --prod /deploy

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV TASK_QUEUE=pa-workflow

CMD ["node", "dist/temporal/worker.js"]
