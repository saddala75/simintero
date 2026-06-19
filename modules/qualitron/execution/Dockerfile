# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY modules/qualitron/execution/package.json ./modules/qualitron/execution/
COPY modules/qualitron/gaps/package.json ./modules/qualitron/gaps/

RUN pnpm install --frozen-lockfile --filter @sim/qualitron-execution...

COPY modules/qualitron/execution/ ./modules/qualitron/execution/
COPY modules/qualitron/gaps/ ./modules/qualitron/gaps/
# Build the workspace dependency (@sim/qualitron-gaps) too, so its dist/ exists for the import.
RUN pnpm --filter @sim/qualitron-execution... run build
RUN pnpm --filter @sim/qualitron-execution deploy --prod --legacy /app/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/modules/qualitron/execution/dist ./dist

ENV NODE_ENV=production
ENV PORT=3015
EXPOSE 3015

CMD ["node", "dist/server.js"]
