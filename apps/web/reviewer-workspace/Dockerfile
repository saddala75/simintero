FROM node:20-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/reviewer-workspace/package.json ./apps/web/reviewer-workspace/

RUN pnpm install --frozen-lockfile --filter reviewer-workspace...

COPY apps/web/reviewer-workspace/ ./apps/web/reviewer-workspace/
RUN pnpm --filter reviewer-workspace run build

FROM nginx:alpine
COPY --from=builder /repo/apps/web/reviewer-workspace/dist /usr/share/nginx/html
COPY apps/web/reviewer-workspace/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
