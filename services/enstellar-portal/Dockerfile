# syntax=docker/dockerfile:1
# Build context must be the repo root (docker-compose sets context: .)
# so pnpm can resolve workspace:* dependencies.
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/design-system packages/design-system
COPY apps/web apps/web
COPY services/enstellar-portal services/enstellar-portal
RUN pnpm install --frozen-lockfile --filter web...

FROM deps AS build
ARG VITE_KEYCLOAK_URL=http://localhost:8081
ARG VITE_KEYCLOAK_REALM=simintero
ARG VITE_KEYCLOAK_CLIENT_ID=enstellar-app
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
RUN pnpm --filter web build

FROM nginx:1.27-alpine AS runtime
COPY services/enstellar-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/services/enstellar-portal/dist /usr/share/nginx/html
EXPOSE 80
