COMPOSE_FILE := infra/compose/docker-compose.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)
COMPOSE_CONFORMANCE := docker compose -f $(COMPOSE_FILE) -f infra/compose/docker-compose.conformance.yml
CONFORMANCE_PATIENT_IDS ?= example

.PHONY: up down test test-workflow test-connectors test-agents test-portal-bff test-bff lint-agents e2e e2e-seed e2e-teardown conformance scan scan-lint-suppressions scan-sast scan-secrets scan-deps scan-deps-python scan-deps-jvm scan-deps-npm scan-images ps logs codegen seed-db seed-cases test-comms test-x12-translator migrate dev-workflow dev-bff dev-web eval eval-real

## Bring up the full local stack and wait for all services to be healthy.
up:
	$(COMPOSE) up -d --build --wait

## Tear down the local stack and remove volumes.
down:
	$(COMPOSE) down -v

## Run codegen for all packages (re-generates types from JSON Schema).
codegen:
	cd packages/canonical-model && uv run python codegen/generate.py

## Run workflow-engine tests only.
test-workflow:
	cd services/workflow-engine && uv run pytest -v

## Run integration-connectors tests only (unit; no external services required).
test-connectors:
	cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"

## Run Revital client tests only (unit; no external services required).
test-revital:
	cd services/integration-connectors && uv run pytest tests/test_revital_models.py tests/test_revital_client.py tests/test_phi_minimizer.py -v -m "not integration"

## Run HAPI FHIR interop tests only (Testcontainers — requires Docker).
interop-test:
	cd services/interop && ./gradlew test

## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd services/workflow-engine && uv run pytest -v
	cd services/integration-connectors && uv run pytest tests/ -v -m "not integration"
	cd services/agent-layer && uv run pytest -v
	cd services/portal-bff && uv run pytest -v
	$(MAKE) interop-test

## Run end-to-end tests (both PA paths). Requires make up first.
## Pipeline: seed → pytest path B (direct PAS) → playwright path A (CRD→DTR) → teardown.
e2e: e2e-seed
	@set -e; \
	  trap '$(MAKE) e2e-teardown' EXIT; \
	  cd tests/e2e && E2E_MANIFEST=$(CURDIR)/infra/compose/e2e-fixture-manifest.json \
	    uv run pytest -v \
	    --json-report --json-report-file=/tmp/e2e-pytest.json; \
	  cd $(CURDIR)/apps/web && \
	    PLAYWRIGHT_REAL_STACK=1 \
	    E2E_MANIFEST=../../infra/compose/e2e-fixture-manifest.json \
	    E2E_USER=$${E2E_USER} \
	    E2E_PASSWORD=$${E2E_PASSWORD} \
	    npx playwright test e2e/real-stack/

## Seed E2E FHIR fixtures and create PA case; writes e2e-fixture-manifest.json.
e2e-seed:
	E2E_PASSWORD=$${E2E_PASSWORD:-e2e-pass} \
	uv run --project services/workflow-engine python scripts/e2e_seed.py

## Delete seeded E2E FHIR fixtures from HAPI (idempotent; ignores 404).
e2e-teardown:
	E2E_PASSWORD=$${E2E_PASSWORD:-e2e-pass} \
	uv run --project services/workflow-engine python scripts/e2e_teardown.py

## Run FHIR conformance tests (Inferno US Core v5.0.1 + Da Vinci PAS v2.0.1).
## Brings up the full stack with the conformance profile, runs both suites,
## writes JSON results to /tmp/inferno-us-core.json and /tmp/inferno-pas.json,
## then tears down (even on failure). Exits non-zero if either suite fails.
## Override CONFORMANCE_PATIENT_IDS=<id> to set US Core patient fixture IDs.
conformance:
	@set -e; \
	  trap '$(COMPOSE_CONFORMANCE) down -v' EXIT; \
	  $(COMPOSE_CONFORMANCE) up -d --profile conformance --build --wait; \
	  echo "→ Running US Core v5.0.1 suite"; \
	  $(COMPOSE_CONFORMANCE) exec -T inferno \
	    bundle exec inferno execute \
	      --suite us_core_v501 \
	      --inputs url:http://interop:8080/fhir \
	               patient_ids:$(CONFORMANCE_PATIENT_IDS) \
	               'smart_auth_info:{"auth_type":"bearer","access_token":"conformance-test-token"}' \
	      --outputter json \
	    > /tmp/inferno-us-core.json; \
	  echo "→ Running Da Vinci PAS v2.0.1 suite"; \
	  $(COMPOSE_CONFORMANCE) exec -T inferno \
	    bundle exec inferno execute \
	      --suite davinci_pas_server_suite_v201 \
	      --inputs server_endpoint:http://interop:8080/fhir \
	               access_token:conformance-test-token \
	      --outputter json \
	    > /tmp/inferno-pas.json; \
	  echo "✓ Conformance results written to /tmp/inferno-us-core.json and /tmp/inferno-pas.json"

## Run all security scans: SAST, secrets, dependencies, container images.
## Fails on any HIGH or CRITICAL finding. See docs/security/SUPPRESSION.md for suppression guidance.
scan: scan-lint-suppressions scan-sast scan-secrets scan-deps scan-images

## Lint suppression files: every entry must have an expiry date comment.
scan-lint-suppressions:
	@echo "→ Linting suppression files for expiry dates..."
	@# .trivyignore: every CVE line must be preceded by a comment containing 'expires YYYY-MM-DD'
	@awk '/^CVE-/{found=1} /expires [0-9]{4}-[0-9]{2}-[0-9]{2}/{found=0} /^CVE-/ && found{print FILENAME ":" NR ": CVE entry missing expiry date: " $$0; exit 1}' .trivyignore || exit 1
	@# pip-audit-ignore.txt: every PYSEC/CVE line must be preceded by 'expires YYYY-MM-DD'
	@awk '/^(PYSEC|CVE)-/{found=1} /expires [0-9]{4}-[0-9]{2}-[0-9]{2}/{found=0} /^(PYSEC|CVE)-/ && found{print FILENAME ":" NR ": entry missing expiry date: " $$0; exit 1}' pip-audit-ignore.txt || exit 1
	@echo "✓ All suppression entries have expiry dates"

## SAST scan via Semgrep (auto ruleset + project rules).
scan-sast:
	semgrep scan --config auto --config .semgrep.yml \
	  --severity ERROR --severity WARNING \
	  --output /tmp/semgrep.sarif --sarif \
	  --error

## Secret scan via gitleaks (new secrets only; baseline suppresses pre-existing).
scan-secrets:
	gitleaks detect --source . \
	  --config .gitleaks.toml \
	  --baseline-path .gitleaks-baseline.json \
	  --report-format json --report-path /tmp/gitleaks.json

## Dependency vulnerability scan across all stacks.
scan-deps: scan-deps-python scan-deps-jvm scan-deps-npm

scan-deps-python:
	cd services/workflow-engine        && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-workflow.json -f json
	cd services/agent-layer            && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-agents.json -f json
	cd services/portal-bff             && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-bff.json -f json
	cd services/integration-connectors && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-connectors.json -f json

scan-deps-jvm:
	cd services/interop && NVD_API_KEY=$${NVD_API_KEY:-} ./gradlew dependencyCheckAnalyze

scan-deps-npm:
	cd apps/web && npm audit --audit-level=high

## Container image scan via Trivy (HIGH and CRITICAL CVEs).
scan-images:
	$(COMPOSE) build
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-interop.json \
	  enstellar-local-interop
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-workflow.json \
	  enstellar-local-workflow-engine
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-agents.json \
	  enstellar-local-agent-layer
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-bff.json \
	  enstellar-local-portal-bff
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-web.json \
	  enstellar-local-web

## Smoke-test the running stack (run after `make up`).
smoke:
	@echo "→ interop /fhir/metadata"; \
	  $(COMPOSE) exec -T interop java -jar /healthcheck.jar http://localhost:8080/fhir/metadata && echo "  interop OK"
	@echo "→ workflow-engine /health"; \
	  $(COMPOSE) exec -T workflow-engine python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" && echo "  workflow OK"
	@echo "→ portal-bff /healthz"; \
	  $(COMPOSE) exec -T portal-bff python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/healthz')" && echo "  bff OK"
	@echo "→ web /"; \
	  curl -fsS -o /dev/null http://127.0.0.1:$${WEB_PORT:-5173}/ && echo "  web OK"
	@echo "✓ Smoke passed"

## Run agent evals (mock adapter by default; fast, no API cost).
## Use EVAL_ADAPTER=anthropic ANTHROPIC_API_KEY=<key> for real model signal.
eval:
	uv run --project services/agent-layer python -m evals.runner

## Run evals against real Claude API (requires ANTHROPIC_API_KEY env var).
eval-real:
	EVAL_ADAPTER=anthropic uv run --project services/agent-layer python -m evals.runner

## Run agent-layer tests only.
test-agents:
	cd services/agent-layer && uv run pytest -v

## Run ruff + mypy on the agent layer.
lint-agents:
	cd services/agent-layer && uv run ruff check enstellar_agents/
	cd services/agent-layer && uv run mypy enstellar_agents/

## Run portal-bff unit + integration tests.
test-portal-bff:
	cd services/portal-bff && uv run pytest -v

## Run portal-bff tests only (alias for test-portal-bff).
test-bff:
	cd services/portal-bff && uv run pytest -v

## Run web unit tests (tsc type-check).
test-web:
	cd apps/web && npm ci && npx tsc --noEmit

## Run Playwright E2E tests for the reviewer UI (starts mock BFF + Vite automatically).
e2e-web:
	cd apps/web && npx playwright test

## Show status of running services.
ps:
	$(COMPOSE) ps

## Tail logs for all services (or pass SERVICE=<name> to filter).
logs:
	$(COMPOSE) logs -f $(SERVICE)

## Seed 6 realistic PA cases for tenant-dev into the local workflow-db (requires make up + make migrate).
seed-cases:
	uv run --project services/workflow-engine python scripts/seed_cases.py

## Seed notification templates into the workflow-engine DB (local dev / demo).
seed-db:
	cd services/workflow-engine && uv run python -c \
	  "import asyncpg, asyncio; \
	   conn = asyncio.run(asyncpg.connect('$(WORKFLOW_DB_URL)')); \
	   asyncio.run(conn.execute(open('db/seeds/notification_templates.sql').read())); \
	   asyncio.run(conn.close())"

## Run comms subsystem tests only.
test-comms:
	cd services/workflow-engine && uv run pytest tests/comms/ -v

## Run X12 translator tests only (Testcontainers — requires Docker).
test-x12-translator:
	cd services/interop && ./gradlew :x12-translator:test

## Run Alembic migrations against the local workflow-db (requires make up first).
migrate:
	cd services/workflow-engine && uv run alembic upgrade head

## Start workflow-engine locally against the local stack DB (requires make up + make migrate).
dev-workflow:
	cd services/workflow-engine && uv run uvicorn enstellar_workflow.main:app --reload --host 0.0.0.0 --port 8000

## Start BFF locally, pointing at the local workflow-engine, with auth bypass enabled.
## Do NOT set BFF_DEV_BYPASS_AUTH in staging or production.
dev-bff:
	cd services/portal-bff && \
	  BFF_WORKFLOW_ENGINE_URL=http://localhost:8000 \
	  BFF_DEV_BYPASS_AUTH=1 \
	  uv run uvicorn enstellar_bff.main:app --reload --host 0.0.0.0 --port 8001

## Start the Vite dev server (proxies /bff → localhost:8001).
dev-web:
	cd apps/web && npm run dev
