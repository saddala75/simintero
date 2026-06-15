# Local / pilot bring-up

Prereqs: Docker + docker compose on the host/VM.

1. `cp infra/compose/.env.example infra/compose/.env` and edit secrets.
2. From the repo root: `make up`  (builds all images and waits for healthchecks)
3. `make smoke`  (verifies interop, workflow-engine, portal-bff, web)
4. Open the UI: http://localhost:5173

Services (all containerized; none run on the host):
- web (nginx) → portal-bff → { workflow-engine, interop }
- interop (FHIR proxy) → hapi (+ hapi-db); writes to redpanda/minio
- workflow-engine → workflow-db, redpanda, minio, agent-layer, mock connectors

Tear down (removes volumes): `make down`
