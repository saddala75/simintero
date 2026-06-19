# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/terminology-service/package.json ./platform/services/terminology-service/
RUN pnpm install --frozen-lockfile --filter @sim/terminology-service...
COPY platform/services/terminology-service/ ./platform/services/terminology-service/
RUN pnpm --filter @sim/terminology-service run build
RUN pnpm --filter @sim/terminology-service deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/terminology-service/dist ./dist
ENV NODE_ENV=production
ENV PORT=3030
EXPOSE 3030
CMD ["node", "dist/index.js"]
