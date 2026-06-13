# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/claims/service/package.json ./modules/claims/service/

RUN pnpm install --frozen-lockfile --filter @sim/claims-service...

COPY modules/claims/service/ ./modules/claims/service/
RUN pnpm --filter @sim/claims-service run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/claims/service/dist ./dist
COPY --from=builder /repo/modules/claims/service/node_modules ./node_modules
COPY --from=builder /repo/modules/claims/service/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3016
EXPOSE 3016

CMD ["node", "dist/index.js"]
