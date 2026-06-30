# Enstellar Portal

React + TypeScript + Vite SPA. The primary clinical operations UI for the Simintero platform — prior authorization review, MD adverse decisions, appeals, grievances, RFI management, EHR simulator, and quality console.

## Running locally

The portal runs inside Docker Compose as the `web` service (nginx on port 5173). Engineers use the full-stack `make up` at the repo root — there is no need to run it standalone.

```bash
# From the repo root:
make up
# Portal: http://localhost:5173
# Login: md-reviewer / e2e-pass
```

## Local dev server (hot reload)

For active frontend development, run Vite's dev server against the already-running Docker backend:

```bash
# Prerequisites: Node 20+, pnpm 10+
cd services/enstellar-portal
pnpm install
pnpm dev
# → http://localhost:5174 (Vite dev server, proxies /bff/* to portal-bff on :8001)
```

The Vite config proxies `/bff/*` to `http://localhost:8001` and `/auth/*` to `http://localhost:8081`, so Keycloak OIDC and all BFF API calls work without CORS issues.

## Building the Docker image

```bash
# From repo root:
docker compose build web

# Rebuild and restart just the portal:
docker compose up -d --no-deps web
```

## Project layout

```
src/
├── api/          # apiFetch wrapper + typed API client
├── auth/         # Keycloak-js OIDC (AuthContext, useAuth, hasRole)
├── components/   # Shared UI components (AppShell, QuestionnaireRenderer, etc.)
├── pages/        # Route-level page components
└── main.tsx      # App entry + React Router v7 setup
```

## Auth

Uses `keycloak-js` (public OIDC client `enstellar-app`, no client secret). Token stored in memory only; `apiFetch` attaches it as `Authorization: Bearer <token>` on every request. Role-based route gating via `hasRole(auth, 'medical_director')` etc.

## Design system

All UI components come from `@sim/design-system` (workspace package at `packages/design-system`). Use `<Button variant="primary">`, `<Card>`, etc. — do **not** use raw `<button>` elements with Tailwind classes; they render invisibly in the current theme.

## Tests

```bash
pnpm test        # Vitest unit tests
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
```

E2E tests live at `integration/e2e/` and run via `make smoke` at the repo root (requires full stack up).
