FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY integration/connectors/cds-hooks/package.json ./integration/connectors/cds-hooks/
RUN pnpm install --frozen-lockfile --filter @sim/connector-cds-hooks...
COPY integration/connectors/cds-hooks/ ./integration/connectors/cds-hooks/
RUN pnpm --filter @sim/connector-cds-hooks run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /repo/integration/connectors/cds-hooks/dist ./dist
COPY --from=builder /repo/integration/connectors/cds-hooks/node_modules ./node_modules
COPY --from=builder /repo/integration/connectors/cds-hooks/package.json ./package.json
ENV NODE_ENV=production
ENV PORT=3050
EXPOSE 3050
CMD ["node", "dist/server.js"]
