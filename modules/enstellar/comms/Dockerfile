# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY modules/enstellar/comms/package.json ./modules/enstellar/comms/

RUN pnpm install --frozen-lockfile --filter @sim/enstellar-comms...

COPY modules/enstellar/comms/ ./modules/enstellar/comms/
RUN pnpm --filter @sim/enstellar-comms run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/modules/enstellar/comms/dist ./dist
COPY --from=builder /repo/modules/enstellar/comms/node_modules ./node_modules
COPY --from=builder /repo/modules/enstellar/comms/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3022
EXPOSE 3022

CMD ["node", "dist/index.js"]
