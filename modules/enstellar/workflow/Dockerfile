FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/enstellar/workflow/package.json ./modules/enstellar/workflow/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-workflow...

COPY modules/enstellar/workflow/ ./modules/enstellar/workflow/
RUN pnpm --filter @sim/enstellar-workflow run build

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/enstellar/workflow/dist ./dist
COPY --from=builder /repo/modules/enstellar/workflow/node_modules ./node_modules
COPY --from=builder /repo/modules/enstellar/workflow/package.json ./package.json

ENV NODE_ENV=production
ENV TASK_QUEUE=pa-workflow

CMD ["node", "dist/temporal/worker.js"]
