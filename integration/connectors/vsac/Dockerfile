FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY integration/connectors/vsac/package.json ./integration/connectors/vsac/
RUN pnpm install --frozen-lockfile --filter @sim/connector-vsac...
COPY integration/connectors/vsac/ ./integration/connectors/vsac/
RUN pnpm --filter @sim/connector-vsac run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /repo/integration/connectors/vsac/dist ./dist
COPY --from=builder /repo/integration/connectors/vsac/node_modules ./node_modules
COPY --from=builder /repo/integration/connectors/vsac/package.json ./package.json
ENV NODE_ENV=production
ENV PORT=3051
EXPOSE 3051
CMD ["node", "dist/VsacProxy.js"]
