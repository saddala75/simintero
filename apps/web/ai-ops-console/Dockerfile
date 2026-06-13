FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/ai-ops-console/package.json ./apps/web/ai-ops-console/

RUN pnpm install --frozen-lockfile --filter ai-ops-console...

COPY apps/web/ai-ops-console/ ./apps/web/ai-ops-console/
RUN pnpm --filter ai-ops-console run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/ai-ops-console/dist /usr/share/nginx/html
COPY apps/web/ai-ops-console/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
