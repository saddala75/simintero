# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY platform/services/document/package.json ./platform/services/document/

RUN pnpm install --frozen-lockfile --filter @sim/document...

COPY platform/services/document/ ./platform/services/document/
RUN pnpm --filter @sim/document run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/platform/services/document/dist ./dist
COPY --from=builder /repo/platform/services/document/node_modules ./node_modules
COPY --from=builder /repo/platform/services/document/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3010
EXPOSE 3010

CMD ["node", "dist/index.js"]
