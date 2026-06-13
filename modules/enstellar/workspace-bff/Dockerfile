# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/enstellar/workspace-bff/package.json ./modules/enstellar/workspace-bff/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-workspace-bff...

COPY modules/enstellar/workspace-bff/ ./modules/enstellar/workspace-bff/
RUN pnpm --filter @sim/enstellar-workspace-bff run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/enstellar/workspace-bff/dist ./dist
COPY --from=builder /repo/modules/enstellar/workspace-bff/node_modules ./node_modules
COPY --from=builder /repo/modules/enstellar/workspace-bff/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3021
EXPOSE 3021

CMD ["node", "dist/index.js"]
