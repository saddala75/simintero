# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY modules/revital/pipeline/package.json   ./modules/revital/pipeline/
COPY modules/revital/extraction/package.json ./modules/revital/extraction/

RUN pnpm install --frozen-lockfile --filter @sim/revital-pipeline...

COPY modules/revital/pipeline/   ./modules/revital/pipeline/
COPY modules/revital/extraction/ ./modules/revital/extraction/

# Build workspace lib first
RUN pnpm --filter @sim/revital-extraction run build

# Build the service
RUN pnpm --filter @sim/revital-pipeline run build

# Self-contained production bundle
RUN pnpm --filter @sim/revital-pipeline deploy --legacy --prod /deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /deploy .

ENV NODE_ENV=production
ENV PORT=3014
EXPOSE 3014

CMD ["node", "dist/index.js"]
