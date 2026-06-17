# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/automation/service/package.json ./modules/automation/service/

RUN pnpm install --frozen-lockfile --filter @sim/automation-service...

COPY modules/automation/service/ ./modules/automation/service/
RUN pnpm --filter @sim/automation-service run build
RUN pnpm --filter @sim/automation-service deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/automation/service/dist ./dist

ENV NODE_ENV=production
ENV PORT=3017
EXPOSE 3017

CMD ["node", "dist/index.js"]
