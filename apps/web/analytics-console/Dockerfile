FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/analytics-console/package.json ./apps/web/analytics-console/

RUN pnpm install --frozen-lockfile --filter analytics-console...

COPY apps/web/analytics-console/ ./apps/web/analytics-console/
RUN pnpm --filter analytics-console run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/analytics-console/dist /usr/share/nginx/html
COPY apps/web/analytics-console/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
