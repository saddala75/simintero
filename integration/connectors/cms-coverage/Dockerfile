FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY integration/connectors/cms-coverage/package.json ./integration/connectors/cms-coverage/
RUN pnpm install --frozen-lockfile --filter @sim/connector-cms-coverage...
COPY integration/connectors/cms-coverage/ ./integration/connectors/cms-coverage/
RUN pnpm --filter @sim/connector-cms-coverage run build
RUN pnpm --filter @sim/connector-cms-coverage deploy --prod --legacy /app/deploy

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
COPY --from=builder /repo/integration/connectors/cms-coverage/dist ./dist
ENV NODE_ENV=production
ENV PORT=3055
EXPOSE 3055
CMD ["node", "dist/CmsCoverageProxy.js"]
