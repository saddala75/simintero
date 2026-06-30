# syntax=docker/dockerfile:1
# Build context must be the repo root (docker-compose sets context: .)
# so pnpm can resolve workspace:* dependencies.
FROM node:22-alpine AS builder
WORKDIR /repo

RUN npm install -g pnpm@10.29.1

# Workspace root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Package manifests first for install layer caching
COPY packages/design-system/package.json ./packages/design-system/
COPY apps/web/reviewer-workspace/package.json ./apps/web/reviewer-workspace/
COPY apps/web/digicore-console/package.json ./apps/web/digicore-console/
COPY apps/web/quality-console/package.json ./apps/web/quality-console/
COPY apps/web/analytics-console/package.json ./apps/web/analytics-console/
COPY apps/web/ai-ops-console/package.json ./apps/web/ai-ops-console/
COPY apps/web/saas-admin/package.json ./apps/web/saas-admin/
COPY apps/web/support-console/package.json ./apps/web/support-console/
COPY services/enstellar-portal/package.json ./services/enstellar-portal/

RUN pnpm install --frozen-lockfile --filter web...

# Full source for portal and all workspace packages it imports
COPY packages/design-system/ ./packages/design-system/
COPY apps/web/ ./apps/web/
COPY services/enstellar-portal/ ./services/enstellar-portal/

ARG VITE_KEYCLOAK_URL=http://localhost:8081
ARG VITE_KEYCLOAK_REALM=simintero
ARG VITE_KEYCLOAK_CLIENT_ID=enstellar-app
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

RUN pnpm --filter web build

FROM nginx:1.27-alpine AS runtime
COPY services/enstellar-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/services/enstellar-portal/dist /usr/share/nginx/html
EXPOSE 80
