# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/vkas/package.json ./platform/services/vkas/
RUN pnpm install --frozen-lockfile --filter @sim/vkas...
COPY platform/services/vkas/ ./platform/services/vkas/
RUN pnpm --filter @sim/vkas run build
RUN pnpm --filter @sim/vkas deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/platform/services/vkas/dist ./dist
ENV NODE_ENV=production
ENV PORT=3040
EXPOSE 3040
CMD ["node", "dist/index.js"]
