# Simintero Platform

A unified prior-authorization and quality-measure platform for payer workflows.  
Single-repo, polyglot (Python + TypeScript + Java), fully containerized.

---

## What's in the box

| Layer | Services |
|-------|----------|
| **FHIR / Interop** | `interop` (HAPI proxy + PAS `$submit`), `hapi` (HAPI FHIR R4) |
| **Workflow engine** | `workflow-engine` (FastAPI + Kafka consumers — PA lifecycle) |
| **Clinical intelligence** | `digicore-runtime` (CQL evaluator), `revital-pipeline` + `revital-worker` (AI advisory) |
| **Model / AI** | `model-gateway` (Temporal workflows), `mock-llm` (dev stand-in for Anthropic) |
| **Rule authoring** | `digicore-authoring` (rule editor), `digicore-governance` (approval gates), `vkas` (versioned artifact store) |
| **Quality measures** | `qualitron`, `qualitron-aggregation`, `qualitron-reporting` |
| **Supporting** | `document-service`, `terminology-service`, `task-service`, `portal-bff`, `web` (React portal) |
| **Infrastructure** | Postgres 16, Redpanda (Kafka), Temporal, MinIO, Keycloak, OPA, OpenSearch, Redis |
| **Observability** | Grafana, Prometheus, Loki, Tempo, OpenTelemetry Collector |

46 containers total. Runs entirely locally via Docker Compose.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Docker Desktop** | 4.x+ | Includes Compose v2. Linux: install Docker Engine + Compose plugin separately |
| **Git** | any | For cloning |
| **8 GB RAM** (free) | — | HAPI alone uses ~1.5 GB; full stack ~6 GB |
| **15 GB disk** | — | ~10 GB images + data volumes |

**macOS:** Docker Desktop → Settings → Resources → set Memory ≥ 8 GB.  
**Linux:** No special config needed if your machine has 8+ GB free.

### Optional API keys

These are only needed for the features they power. Everything in the smoke test works without them.

| Variable | What it enables |
|----------|----------------|
| `ANTHROPIC_API_KEY` | Real Claude inference in `model-gateway` (dev uses `mock-llm` without it) |
| `VSAC_API_KEY` | Live VSAC value-set downloads (seeded local data is used without it) |
| `CLEARINGHOUSE_URL` + `CLEARINGHOUSE_API_KEY` | X12 clearinghouse integration (disabled without it) |

Set them in your shell or in a `.env` file in the repo root:

```bash
# .env  (never commit this file)
ANTHROPIC_API_KEY=sk-ant-...
VSAC_API_KEY=...
```

---

## Quick start

```bash
git clone https://github.com/saddala75/simintero.git
cd simintero

# First run: pull images, build all services, start (5-15 min — HAPI loads IGs)
make up-build

# Verify the platform end-to-end (~5 min)
make smoke
```

On subsequent starts (images already built, volumes intact):

```bash
make up     # ~60-90 seconds
```

---

## What `make up` does

1. Checks that Docker is running
2. Runs `docker compose up -d` for all 46 services
3. Polls each service's healthcheck until `healthy` (or times out at 450 s) — HAPI is included via the `interop` service dependency
4. Prints the service URLs

**First boot is slow** because:
- Docker pulls ~10 GB of base images
- HAPI loads US Core, PAS, DTR, and CRD IGs from the embedded artifact store (up to 15 min; `start_period: 900s`)
- Keycloak imports the `simintero` realm

After the first boot the images are cached and volumes are intact, so `make up` takes ~60–90 s.

---

## Stopping and resetting

```bash
make down       # stop containers, keep data volumes → fast restart next time

make clean      # stop + delete all volumes → next start rebuilds from scratch
                # use this when you want a clean state (e.g. after schema changes)
```

Advanced options via the scripts directly:

```bash
./scripts/platform-up.sh --build            # rebuild all images then start
./scripts/platform-down.sh --clean --images  # delete volumes AND built images (full wipe)
```

---

## Service URLs

After `make up`:

| Service | URL | Credentials |
|---------|-----|-------------|
| **Portal (React UI)** | http://localhost:5173 | log in with Keycloak (see Test users below) |
| **Portal BFF API** | http://localhost:8001/docs | use a Keycloak token (see Manual API testing) |
| **Interop FHIR** | http://localhost:8080/fhir/metadata | — |
| **HAPI FHIR (raw)** | http://localhost:8090/fhir/metadata | — |
| **Keycloak admin** | http://localhost:8081 | `admin` / `admin` |
| **Mailpit (email)** | http://localhost:8025 | — dev email catcher; all outbound notices land here |
| **Grafana** | http://localhost:3000 | no login (dev mode) |
| **Temporal UI** | http://localhost:8088 | — |
| **MinIO console** | http://localhost:9001 | `minioadmin` / `minioadmin` |
| **Redpanda console** | http://localhost:8082 | — |
| **Prometheus** | http://localhost:9090 | — |
| **OPA** | http://localhost:8181 | — |
| **Digicore runtime** | http://localhost:8083 | — |
| **Governance** | http://localhost:3053 | — |
| **VKAS** | http://localhost:3040 | — |

---

## Test users

All users live in the `simintero` Keycloak realm. Password for all dev users: **`e2e-pass`**

| Username | Roles | Use for |
|----------|-------|---------|
| `md-reviewer` | reviewer, medical_director, appeals_coordinator, grievance_coordinator | Full reviewer flows |
| `dr-jones` | reviewer | Standard reviewer |
| `dr-smith` | reviewer | Standard reviewer (SOD partner for approvals) |
| `e2e-reviewer` | reviewer | Automated tests |

---

## Testing the platform

### Smoke test (automated)

Runs a full end-to-end scenario covering 24 integration points:

```bash
make smoke
```

Takes ~5 minutes. Expects the platform to already be up.

### Manual API testing

**1. Get a JWT:**

```bash
TOKEN=$(curl -sf -X POST http://localhost:8081/realms/simintero/protocol/openid-connect/token \
  -d grant_type=password \
  -d client_id=enstellar-test-client \
  -d client_secret=test-secret \
  -d username=md-reviewer \
  -d password=e2e-pass \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

**2. Submit a PA request:**

```bash
curl -X POST http://localhost:8080/fhir/Claim/\$submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d @services/enstellar-workflow/tests/fixtures/pas_bundle.json
```

**3. Watch it flow through the system:**

```bash
# Poll until the case reaches clinical_review
docker compose exec postgres psql -U sim -d workflow \
  -c "SELECT correlation_id, status FROM workflow_instances ORDER BY created_at DESC LIMIT 5;"
```

**4. Use the BFF API (Swagger UI):**  
Open http://localhost:8001/docs, click **Authorize**, paste the token.

**5. Evaluate a coverage rule directly:**

```bash
# Does CPT 29826 need PA?
curl -X POST http://localhost:8083/v1/runtime/coverage-discovery \
  -H "Content-Type: application/json" \
  -d '{"service_code":"29826","procedure_code":"29826"}'

# Evaluate against criteria
curl -X POST http://localhost:8083/v1/runtime/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "case_id":"manual-test-1",
    "service_code":"29826",
    "pins":[],
    "evidence":{
      "imaging_confirms_pathology":true,
      "failed_conservative_therapy":true
    }
  }'
```

---

## Repository layout

```
simintero/
├── services/               # Application services
│   ├── enstellar-workflow/         # PA workflow engine (Python/FastAPI)
│   ├── enstellar-portal-bff/       # Portal backend-for-frontend (Python/FastAPI)
│   ├── enstellar-interop/          # FHIR interop layer (Java/Spring)
│   └── enstellar-connectors/       # External integration connectors
├── modules/                # Shared TypeScript modules
│   └── digicore/
│       ├── governance/     # Approval-gate service (Node.js)
│       ├── authoring/      # Rule authoring service (Node.js)
│       └── runtime/        # CQL rule engine (Node.js)
├── platform/               # Platform infrastructure services
│   ├── services/
│   │   ├── vkas/           # Versioned artifact store (Node.js)
│   │   ├── model-gateway/  # AI model orchestration (Node.js/Temporal)
│   │   ├── document/       # Document ingestion + storage
│   │   ├── qualitron/      # Quality measure engine
│   │   └── task-service/   # Task and worklist management
│   └── libs/               # Shared libraries (authz, otel, outbox, ...)
├── infra/                  # Infra config (Keycloak realm, Postgres init, OPA policies, ...)
├── scripts/                # Operational scripts
│   ├── platform-up.sh      # Start the platform
│   ├── platform-down.sh    # Stop the platform
│   └── smoke-unified-stack.sh  # End-to-end smoke test
├── docker-compose.yml      # All 46 services wired together
└── Makefile                # Common commands
```

---

## Rebuilding after code changes

Changes to service source code require rebuilding the Docker image for that service:

```bash
# Rebuild a single service and restart it
docker compose build workflow-engine
docker compose up -d --no-deps workflow-engine

# Rebuild everything
make up-build
```

For the TypeScript services under `modules/` and `platform/services/`, the compiled `dist/` is built inside the Docker image — edit the `src/` files, then rebuild the image.

---

## Troubleshooting

**`make up` times out (HAPI / `interop` still not healthy)**  
HAPI loads ~500 MB of FHIR IGs on first boot — this can take up to 15 minutes. The `interop` service won't become healthy until HAPI finishes, so `make up` will wait. Check for OOM:
```bash
docker logs simintero-hapi-1 2>&1 | tail -30
```
If you see exit code 137 (SIGKILL), Docker doesn't have enough memory. Increase to 8 GB in Docker Desktop → Settings → Resources → Memory.

**`interop` is unhealthy after HAPI restart**  
Interop's JVM caches a negative DNS lookup for `hapi` if HAPI was down when interop started. Fix:
```bash
docker network disconnect simintero_sim-net simintero-hapi-1
docker network connect --alias hapi simintero_sim-net simintero-hapi-1
docker compose restart interop
```

**`otel-collector` shows unhealthy during `compose up`**  
Transient — the collector's self-test times out under load. `make up` tolerates this and the post-check confirms it recovers.

**`digicore-governance` exits with code 1**  
Usually VKAS returned an unexpected error during rule activation. Check:
```bash
docker logs simintero-digicore-governance-1
docker compose up -d --no-deps digicore-governance
```

**Port conflict (address already in use)**  
Another process is using one of the exposed ports. Find and stop it:
```bash
lsof -i :8080    # or whichever port is conflicting
```

**Email notices not appearing**  
All outbound email in dev goes to Mailpit (an in-process catcher, not a real SMTP server). Open http://localhost:8025 to see everything sent. There is no real mail delivery in dev — this is by design.

**Starting fresh after a failed run**  
```bash
make clean   # wipe volumes
make up      # start clean
```

---

## Environment variables reference

All have safe defaults for local development. Only set the ones you need.

| Variable | Default | Required for |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(empty)* | Real Claude inference (optional — mock-llm used otherwise) |
| `VSAC_API_KEY` | *(empty)* | Live VSAC value-set downloads (optional) |
| `CLEARINGHOUSE_URL` | *(empty)* | X12 clearinghouse integration (optional) |
| `CLEARINGHOUSE_API_KEY` | *(empty)* | X12 clearinghouse integration (optional) |
| `E2E_PASSWORD` | `e2e-pass` | Test user passwords in Keycloak |
| `TEST_CLIENT_SECRET` | `test-secret` | `enstellar-test-client` Keycloak client secret |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin` | Keycloak admin console login |

Place any overrides in a `.env` file at the repo root (not committed):

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```
