# Conformance CI Gate (SP4) + Security & Supply-Chain Gate (SP5) — Design

**Status:** Approved (2026-06-09). Parallel sub-projects; both gate nightly, not on PRs.
**Owner:** Senior engineer review required — touches FHIR conformance, infra/IaC, and security posture (all mandatory-review areas per CLAUDE.md).
**Depends on:** Sub-project 1 (deployability) — `services/interop/Dockerfile` and compose wiring already shipped on `deployability-foundation` (merged PR #3).
**Serves:** P1 exit criteria — conformance-smoke prerequisite (SP4) + payer security posture (SP5).

---

## Context

Sub-projects 1 (deployability), 2 (CRD), and 3 (DTR) are complete on branch `ehr-integrated-pa`.
`make conformance` and `make scan` are stubs (`echo "No … yet"`). The Inferno `conformance` profile in compose references a non-existent image (`infernoframework/inferno-core:latest`). No security tooling config exists. Both sub-projects are independent of each other and can be implemented in parallel.

The existing conformance follow-up spec (`docs/superpowers/specs/2026-06-08-conformance-ci-followup-design.md`) diagnosed why the original Task 10 was descoped and proposed the Inferno approach; this spec incorporates those decisions and adds SP5.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| CI trigger | **Nightly only** (`0 2 * * *` UTC) + `workflow_dispatch` | Full stack is too heavy for PR CI; both gates run as a scheduled quality signal |
| Security severity threshold | **HIGH and above** fails | Standard payer security posture; allowlist mechanism manages false positives |
| Inferno run mechanism | **CLI** (`bundle exec inferno suite run`) | Natural CI primitive — exit code = pass/fail; verified at image build time |
| Interop DB in conformance compose | **Reuse `workflow-db`** | Keeps conformance compose lean; dedicated DB is a pre-prod concern |
| CI structure | **Single `nightly.yml`, two parallel jobs** | One workflow run; both gates visible together in Actions UI |
| `proxy-enabled` default | **Flip to `true`** | Custom FHIR storage is gone; `false` silently 404s all FHIR CRUD |

---

## SP4 — Conformance CI Gate (Inferno)

### Custom Inferno image

**File:** `infra/compose/inferno/Dockerfile`

```dockerfile
FROM --platform=linux/amd64 infernocommunity/inferno-core:<pinned-digest>

COPY Gemfile Gemfile.lock ./
RUN bundle install && bundle exec inferno suites   # verifies CLI + suite discovery at build time
```

**File:** `infra/compose/inferno/Gemfile` — overlays on the base image's Gemfile:
```ruby
gem "us_core_test_kit",     "<pinned-version>"   # targets US Core 5.0.1
gem "davinci_pas_test_kit", "<pinned-version>"   # targets Da Vinci PAS 2.0.1
```

Notes:
- `linux/amd64` platform is explicit — Inferno publishes amd64 only; arm64 dev hosts run under emulation.
- `bundle exec inferno suites` runs at image build time, failing the build if the CLI is absent or suite discovery errors. Real suite IDs are read from this output, not hard-coded.
- Gem versions and the base image digest must be pinned to exact values in the implementation; placeholders above represent required values to discover.

The `inferno` service in `infra/compose/docker-compose.yml` switches from `image: infernoframework/inferno-core:latest` to `build: infra/compose/inferno` and gains `depends_on: [interop]`.

### Production default fix

`services/interop/src/main/resources/application.yml`: flip `interop.hapi.proxy-enabled` from `false` to `true`. Custom FHIR storage was removed in the conformance-hardening phase (PR #2); the proxy is now the only FHIR-CRUD path. The old default was a safe placeholder; it is now wrong.

### Conformance compose override

**File:** `infra/compose/docker-compose.conformance.yml`

```yaml
services:
  interop:
    environment:
      INTEROP_CONFORMANCE_TEST_MODE: "true"
      INTEROP_CONFORMANCE_TEST_TOKEN: "conformance-test-token"
      INTEROP_HAPI_PROXY_ENABLED: "true"
    depends_on:
      hapi:        { condition: service_healthy }
      workflow-db: { condition: service_healthy }
      redpanda:    { condition: service_healthy }
      minio:       { condition: service_healthy }
      keycloak:    { condition: service_healthy }
```

This override enables `ConformanceTestAuthFilter` (already shipped, property-guarded) so Inferno can authenticate with a static bearer token — no OAuth dance. **Must never be applied in staging or production.**

### Interop DB schema

`workflow-db` hosts both the workflow schema and the interop schema. A Flyway migration in `services/interop` creates a dedicated `interop` schema and `interop_user` role on first start, isolating interop tables from the workflow schema without requiring a separate container.

### `make conformance`

```makefile
COMPOSE_CONFORMANCE := docker compose -f $(COMPOSE_FILE) -f infra/compose/docker-compose.conformance.yml

## Run FHIR conformance tests (Inferno US Core + PAS). Requires custom Inferno image.
conformance:
	$(COMPOSE_CONFORMANCE) up -d --profile conformance --build --wait
	$(COMPOSE_CONFORMANCE) exec -T inferno \
	  bundle exec inferno suite run \
	    --suite us_core \
	    --url http://interop:8080/fhir \
	    --output /tmp/inferno-us-core.json \
	    --bearer-token conformance-test-token
	$(COMPOSE_CONFORMANCE) exec -T inferno \
	  bundle exec inferno suite run \
	    --suite davinci_pas \
	    --url http://interop:8080/fhir \
	    --output /tmp/inferno-pas.json \
	    --bearer-token conformance-test-token
	$(COMPOSE_CONFORMANCE) cp inferno:/tmp/inferno-us-core.json /tmp/inferno-us-core.json
	$(COMPOSE_CONFORMANCE) cp inferno:/tmp/inferno-pas.json /tmp/inferno-pas.json
	$(COMPOSE_CONFORMANCE) down -v
```

Suite IDs (`us_core`, `davinci_pas`) are placeholders — real IDs must be read from `bundle exec inferno suites` output in the custom image. The Makefile exits non-zero if either suite run fails.

### Definition of done (SP4)

- `make conformance` runs the US Core 5.0.1 + PAS 2.0.1 suites against the running `interop` container and exits non-zero on suite failure.
- CI nightly job passes on a clean run; results archived as `inferno-results` artifacts (30-day retention).
- The stale `infernoframework/inferno-core:latest` image reference is gone from compose.
- `interop.hapi.proxy-enabled` defaults to `true` in `application.yml`; existing tests unaffected.
- The conformance override is never wired into the base compose or applied outside the `conformance` profile.

---

## SP5 — Security & Supply-Chain Gate

### Tool inventory

| Class | Tool | Scope |
|---|---|---|
| SAST | Semgrep (`semgrep scan`) | Whole repo |
| Secrets | gitleaks (`gitleaks detect`) | Whole repo (git history) |
| Python deps | `pip-audit` via `uv run pip-audit` | ×4 Python services |
| JVM deps | OWASP Dependency-Check (`./gradlew dependencyCheckAnalyze`) | `services/interop` |
| TypeScript deps | `npm audit --audit-level=high` | `apps/web` |
| Container images | Trivy (`trivy image`) | ×5 first-party images |

### Configuration files

**`.semgrep.yml`** (repo root) — project-level ruleset:
```yaml
rules: []          # start empty; add project-specific rules here
paths:
  exclude:
    - "packages/canonical-model/generated/**"
    - "infra/compose/mocks/**"
```
Inline suppressions use `# nosemgrep: <rule-id>` with a justification comment on the same line.

**`.gitleaks.toml`** (repo root) — minimal config pointing at the baseline:
```toml
[allowlist]
  description = "Baseline established YYYY-MM-DD"
```
On first implementation run, `gitleaks detect --report-path .gitleaks-baseline.json` captures all pre-existing findings into a committed baseline file. Subsequent runs use `--baseline-path .gitleaks-baseline.json`; only new secrets fail.

**`.trivyignore`** (repo root) — CVE suppression list:
```
# CVE-YYYY-NNNNN: <justification> expires YYYY-MM-DD
```

**`pip-audit-ignore.txt`** (repo root) — one `PYSEC-` or `CVE-` ID per line with an inline comment explaining the suppression.

All suppressions require a justification and an expiry date — undated suppressions are rejected by a `pre-commit` hook or linter step (lightweight regex check added to `make scan`).

### `make scan`

```makefile
## Run security scans: SAST (Semgrep), secrets (gitleaks), deps (pip-audit/OWASP/npm), images (Trivy).
scan: scan-sast scan-secrets scan-deps scan-images

scan-sast:
	semgrep scan --config .semgrep.yml --severity ERROR --severity WARNING \
	  --output /tmp/semgrep.sarif --sarif

scan-secrets:
	gitleaks detect --source . --baseline-path .gitleaks-baseline.json \
	  --report-format json --report-path /tmp/gitleaks.json

scan-deps:
	cd services/workflow-engine    && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-workflow.json -f json
	cd services/agent-layer        && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-agents.json -f json
	cd services/portal-bff         && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-bff.json -f json
	cd services/integration-connectors && uv run pip-audit --ignore-vuln-file ../../pip-audit-ignore.txt -o /tmp/pip-audit-connectors.json -f json
	cd services/interop && ./gradlew dependencyCheckAnalyze
	cd apps/web && npm audit --audit-level=high

scan-images:
	docker compose -f $(COMPOSE_FILE) build
	for img in interop workflow-engine agent-layer portal-bff web; do \
	  trivy image --severity HIGH,CRITICAL --exit-code 1 \
	    --ignorefile .trivyignore \
	    --output /tmp/trivy-$$img.json \
	    enstellar-$$img:latest; \
	done
```

Each sub-target exits non-zero on any HIGH+ finding. `make scan` runs all four in sequence; first failure stops the run.

### Definition of done (SP5)

- `make scan` runs all four tool classes locally and exits non-zero on any HIGH+ finding.
- CI nightly job runs `make scan`; reports uploaded as `security-scan-results` artifacts (30-day retention).
- Baseline established and committed: gitleaks baseline, initial `.trivyignore`, initial `pip-audit-ignore.txt` — all pre-existing findings triaged with justifications and expiry dates.
- Suppression mechanism documented: a `docs/security/SUPPRESSION.md` explaining how to add/expire suppressions.
- No new HIGH+ unaddressed findings on the initial nightly run.

---

## Nightly CI workflow

**File:** `.github/workflows/nightly.yml`

```yaml
name: Nightly gates

on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC
  workflow_dispatch:

jobs:
  conformance:
    name: FHIR conformance (Inferno)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Run conformance suite
        run: make conformance
      - name: Upload Inferno results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: inferno-results
          path: /tmp/inferno-*.json
          retention-days: 30
      - name: Tear down stack
        if: always()
        run: docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.conformance.yml down -v

  security-scan:
    name: Security & supply-chain scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # gitleaks needs full history
      - uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install scan tools
        run: |
          pip install semgrep pip-audit uv
          curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh | sh -s -- -b /usr/local/bin
          curl -sSfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
      - name: Run security scans
        run: make scan
      - name: Upload scan results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: security-scan-results
          path: |
            /tmp/semgrep.sarif
            /tmp/gitleaks.json
            /tmp/pip-audit-*.json
            /tmp/trivy-*.json
            services/interop/build/reports/dependency-check-report.html
          retention-days: 30
```

Both jobs run in parallel. Neither appears in `ci.yml`; existing PR CI is untouched. Both can be re-triggered manually via `workflow_dispatch` during development.

---

## Out of scope

- CRD/DTR conformance test kits — added to SP4 after sub-projects 2/3 land (separate follow-up).
- Slack/email alerting on nightly failure — wired later when a notification channel is chosen.
- Non-root Python/web images and digest-pinned base images — deferred SP1 hardening items, not part of this spec.
- Keycloak issuer alignment — deferred to SP6 (end-to-end test).
- Converting nightly to a PR gate — intentionally deferred; revisit when runtime is acceptable for PR CI.

---

## Open items for implementation

1. **Inferno gem versions** — must be pinned to exact versions that target US Core 5.0.1 and PAS 2.0.1; read from RubyGems at implementation time.
2. **Inferno base image digest** — pin `infernocommunity/inferno-core` to a specific digest; discover at implementation time.
3. **Real suite IDs** — read from `bundle exec inferno suites` in the built custom image; replace `us_core` / `davinci_pas` placeholders in the Makefile.
4. **Semgrep rule selection** — `--config auto` uses Semgrep's community ruleset; review and tune for false-positive rate on first run.
5. **OWASP NVD API key** — `dependencyCheckAnalyze` can rate-limit without an NVD API key; obtain one and wire into CI secrets before first run.
