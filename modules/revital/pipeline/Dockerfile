# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/revital/pipeline/package.json ./modules/revital/pipeline/

RUN pnpm install --frozen-lockfile --filter @sim/revital-pipeline...

COPY modules/revital/pipeline/ ./modules/revital/pipeline/
RUN pnpm --filter @sim/revital-pipeline run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/revital/pipeline/dist ./dist
COPY --from=builder /repo/modules/revital/pipeline/node_modules ./node_modules
COPY --from=builder /repo/modules/revital/pipeline/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3014
EXPOSE 3014

CMD ["node", "dist/index.js"]
