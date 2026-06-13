FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/enstellar/clock/package.json ./modules/enstellar/clock/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-clock...

COPY modules/enstellar/clock/ ./modules/enstellar/clock/
RUN pnpm --filter @sim/enstellar-clock run build

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/enstellar/clock/dist ./dist
COPY --from=builder /repo/modules/enstellar/clock/node_modules ./node_modules
COPY --from=builder /repo/modules/enstellar/clock/package.json ./package.json

ENV NODE_ENV=production
ENV TASK_QUEUE=clock-workflow

CMD ["node", "dist/worker-entrypoint.js"]
