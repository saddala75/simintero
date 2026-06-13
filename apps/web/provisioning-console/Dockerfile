FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/provisioning-console/package.json ./apps/web/provisioning-console/

RUN pnpm install --frozen-lockfile --filter provisioning-console...

COPY apps/web/provisioning-console/ ./apps/web/provisioning-console/
RUN pnpm --filter provisioning-console run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/provisioning-console/dist /usr/share/nginx/html
COPY apps/web/provisioning-console/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
