# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/task-service/package.json ./platform/services/task-service/
RUN pnpm install --frozen-lockfile --filter @sim/task-service...
COPY platform/services/task-service/ ./platform/services/task-service/
RUN pnpm --filter @sim/task-service run build
RUN pnpm --filter @sim/task-service deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/task-service/dist ./dist
ENV NODE_ENV=production
ENV PORT=3021
EXPOSE 3021
CMD ["node", "dist/index.js"]
