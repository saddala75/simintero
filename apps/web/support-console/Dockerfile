FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/support-console/package.json ./apps/web/support-console/

RUN pnpm install --frozen-lockfile --filter support-console...

COPY apps/web/support-console/ ./apps/web/support-console/
RUN pnpm --filter support-console run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/support-console/dist /usr/share/nginx/html
COPY apps/web/support-console/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
