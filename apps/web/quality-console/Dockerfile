FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/quality-console/package.json ./apps/web/quality-console/

RUN pnpm install --frozen-lockfile --filter quality-console...

COPY apps/web/quality-console/ ./apps/web/quality-console/
RUN pnpm --filter quality-console run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/quality-console/dist /usr/share/nginx/html
COPY apps/web/quality-console/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
