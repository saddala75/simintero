FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/saas-admin/package.json ./apps/web/saas-admin/

RUN pnpm install --frozen-lockfile --filter saas-admin...

COPY apps/web/saas-admin/ ./apps/web/saas-admin/
RUN pnpm --filter saas-admin run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/saas-admin/dist /usr/share/nginx/html
COPY apps/web/saas-admin/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
