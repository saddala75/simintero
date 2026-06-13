# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/enstellar/case/package.json ./modules/enstellar/case/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-case...

COPY modules/enstellar/case/ ./modules/enstellar/case/
RUN pnpm --filter @sim/enstellar-case run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/enstellar/case/dist ./dist
COPY --from=builder /repo/modules/enstellar/case/node_modules ./node_modules
COPY --from=builder /repo/modules/enstellar/case/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3013
EXPOSE 3013

CMD ["node", "dist/index.js"]
