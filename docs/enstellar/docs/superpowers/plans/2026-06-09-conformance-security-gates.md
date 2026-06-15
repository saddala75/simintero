# SP4 + SP5: Conformance CI Gate & Security Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `make conformance` and `make scan` stubs with real Inferno FHIR conformance testing (US Core 5.0.1 + PAS 2.0.1) and a full security scan (Semgrep + gitleaks + pip-audit + OWASP + Trivy), both gated nightly in CI.

**Architecture:** SP4 and SP5 are fully independent parallel streams — assign them to separate agents or execute sequentially; the only shared deliverable is Task 12 (the nightly CI workflow), which references artifacts from both. SP4 builds a custom Inferno image with real test-kit gems and wires it into a compose conformance profile; SP5 adds four classes of security scanning behind a single `make scan` target. Task 12 combines both into one `.github/workflows/nightly.yml` that runs both jobs in parallel on a schedule.

**Tech Stack:** Inferno Community (Ruby/Bundler), US Core / Da Vinci PAS test-kit gems, Docker Compose profiles, Semgrep, gitleaks, pip-audit, OWASP Dependency Check (Gradle plugin), Trivy, GitHub Actions.

**Design spec:** `docs/superpowers/specs/2026-06-09-conformance-security-gates-design.md`

---

## File map

### SP4 — Conformance gate
| File | Action |
|---|---|
| `services/interop/src/main/resources/application.yml` | Modify — flip `proxy-enabled` default to `true` |
| `infra/compose/inferno/Gemfile` | Create — test-kit gem overlay |
| `infra/compose/inferno/Dockerfile` | Create — custom Inferno image |
| `infra/compose/docker-compose.yml` | Modify — replace `inferno` image with build, add depends_on |
| `infra/compose/docker-compose.conformance.yml` | Create — conformance env override |
| `Makefile` | Modify — replace `conformance` stub |

### SP5 — Security scan
| File | Action |
|---|---|
| `.semgrep.yml` | Create — Semgrep project config |
| `.gitleaks.toml` | Create — gitleaks config |
| `.gitleaks-baseline.json` | Create — generated baseline (via gitleaks detect) |
| `.trivyignore` | Create — initial Trivy CVE suppression file |
| `pip-audit-ignore.txt` | Create — initial pip-audit suppression file |
| `services/interop/build.gradle.kts` | Modify — add OWASP Dependency Check plugin |
| `Makefile` | Modify — replace `scan` stub with sub-targets |
| `docs/security/SUPPRESSION.md` | Create — suppression documentation |

### Shared
| File | Action |
|---|---|
| `.github/workflows/nightly.yml` | Create — nightly scheduled workflow |

---

## STREAM A — SP4: Conformance Gate

### Task 1: Fix proxy-enabled default

The `interop` service's FHIR proxy is the only FHIR-CRUD path since custom storage was removed. The application.yml default of `false` silently 404s all FHIR reads/writes when deployed without the env var override.

**Files:**
- Modify: `services/interop/src/main/resources/application.yml:87`

- [ ] **Step 1: Confirm current default**

```bash
grep "proxy-enabled" services/interop/src/main/resources/application.yml
```

Expected output: `proxy-enabled: ${HAPI_PROXY_ENABLED:false}`

- [ ] **Step 2: Flip the default**

Change line 87 in `application.yml`:

```yaml
# Before:
    proxy-enabled: ${HAPI_PROXY_ENABLED:false}
# After:
    proxy-enabled: ${HAPI_PROXY_ENABLED:true}
```

- [ ] **Step 3: Verify existing interop tests still pass**

```bash
cd services/interop && ./gradlew test
```

Expected: BUILD SUCCESSFUL. `FhirTestBase` already forces `HAPI_PROXY_ENABLED=true` in tests via `@TestPropertySource` or environment override, so no test changes are needed.

- [ ] **Step 4: Commit**

```bash
git add services/interop/src/main/resources/application.yml
git commit -m "fix(interop): default hapi.proxy-enabled to true (proxy is the only FHIR-CRUD path)"
```

---

### Task 2: Discover Inferno gem versions and base image digest

Suite IDs and gem version pins depend on what's available on RubyGems and Docker Hub at implementation time. This task captures those values so Tasks 3–6 can use real pinned versions.

**Files:** (no files changed — discovery only)

- [ ] **Step 1: Pull the Inferno community image and get its digest**

```bash
docker pull infernocommunity/inferno-core:latest
docker inspect infernocommunity/inferno-core:latest \
  --format '{{index .RepoDigests 0}}'
```

Expected: a string like `infernocommunity/inferno-core@sha256:abc123...`. Record this value — it is the pinned digest to use in the Dockerfile `FROM` line.

- [ ] **Step 2: Find the gem version for `us_core_test_kit` targeting US Core 5.0.1**

```bash
gem search us_core_test_kit --remote --all 2>/dev/null | head -5
# Or via curl if gem is not installed locally:
curl -s https://rubygems.org/api/v1/gems/us_core_test_kit.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"
```

Record the latest version. Verify it targets US Core 5.0.1 by checking its README or changelog at `https://github.com/inferno-framework/us-core-test-kit`.

- [ ] **Step 3: Find the gem version for `davinci_pas_test_kit` targeting PAS 2.0.1**

```bash
curl -s https://rubygems.org/api/v1/gems/davinci_pas_test_kit.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"
```

Record the latest version. Verify it targets Da Vinci PAS 2.0.1 at `https://github.com/inferno-framework/davinci-pas-test-kit`.

- [ ] **Step 4: Note discovered values**

After this task you must have three concrete values:
- `INFERNO_DIGEST` — e.g. `sha256:abc123...` (from Step 1)
- `US_CORE_VERSION` — e.g. `0.9.0` (from Step 2)
- `PAS_VERSION` — e.g. `0.12.0` (from Step 3)

These are used verbatim in Task 3.

---

### Task 3: Create custom Inferno image

**Files:**
- Create: `infra/compose/inferno/Gemfile`
- Create: `infra/compose/inferno/Dockerfile`

- [ ] **Step 1: Create the gem overlay Gemfile**

Use the gem versions discovered in Task 2. Replace `<US_CORE_VERSION>` and `<PAS_VERSION>` with the actual discovered values.

Create `infra/compose/inferno/Gemfile`:
```ruby
# Overlay on the base infernocommunity/inferno-core image.
# Adds US Core 5.0.1 and Da Vinci PAS 2.0.1 test-kit gems.
# Pin versions to the values discovered at build time (see Task 2).
source "https://rubygems.org"

eval_gemfile "/app/Gemfile"   # inherit the base image's Gemfile

gem "us_core_test_kit",     "~> <US_CORE_VERSION>"
gem "davinci_pas_test_kit",  "~> <PAS_VERSION>"
```

- [ ] **Step 2: Create the Dockerfile**

Replace `<INFERNO_DIGEST>` with the value from Task 2 Step 1.

Create `infra/compose/inferno/Dockerfile`:
```dockerfile
# Custom Inferno image: adds US Core 5.0.1 + Da Vinci PAS 2.0.1 test kits.
# Must be built with --platform linux/amd64 (Inferno publishes amd64 only).
# On arm64 hosts this runs under emulation — slower but functional.
FROM --platform=linux/amd64 infernocommunity/inferno-core@<INFERNO_DIGEST>

WORKDIR /app

COPY Gemfile ./Gemfile.custom
# Merge the overlay into the existing Gemfile and reinstall
RUN cat Gemfile.custom >> Gemfile && \
    bundle install --jobs 4 && \
    bundle exec inferno suites

# Keep the default CMD (bundle exec puma) — we exec the CLI over it.
```

The `bundle exec inferno suites` line at build time:
- Verifies the Inferno CLI binary is present and functional
- Confirms both test kits are loadable
- Prints the real suite IDs — **record the IDs for us-core and davinci-pas suites from this output** (needed in Task 6)

- [ ] **Step 3: Build the image and capture suite IDs**

```bash
cd infra/compose/inferno
docker build --platform linux/amd64 -t enstellar-inferno-test:local . 2>&1 | tee /tmp/inferno-build.log
grep -i "suite\|id:" /tmp/inferno-build.log | head -30
```

Expected: BUILD succeeds; the `bundle exec inferno suites` output lists suites including `us_core_v501` (or similar) and `davinci_pas_v201` (or similar). **Record the exact suite IDs** — they are used in Task 6.

If the build fails because `eval_gemfile` is not a valid directive in this Inferno gem version, replace it with a standalone Gemfile that duplicates the base image's gem declarations (check with `docker run --rm --entrypoint cat infernocommunity/inferno-core@<DIGEST> /app/Gemfile`).

- [ ] **Step 4: Commit**

```bash
git add infra/compose/inferno/
git commit -m "feat(conformance): custom Inferno image with US Core 5.0.1 + PAS 2.0.1 test kits"
```

---

### Task 4: Update compose inferno service

Replace the stale non-existent `infernoframework/inferno-core:latest` image reference with the custom build and add the `depends_on: [interop]` that was deferred when SP1 shipped without an interop container.

**Files:**
- Modify: `infra/compose/docker-compose.yml:212-222`

- [ ] **Step 1: Locate the current inferno service definition**

```bash
grep -n "inferno" infra/compose/docker-compose.yml
```

Expected: lines around 212–222 showing `image: infernoframework/inferno-core:latest`.

- [ ] **Step 2: Replace the inferno service definition**

Find and replace this block in `infra/compose/docker-compose.yml`:
```yaml
  inferno:
    image: infernoframework/inferno-core:latest
    profiles: ["conformance"]
    environment:
      FHIR_BASE_URL: http://interop:8080/fhir
    ports:
      - "4567:4567"
```

With:
```yaml
  inferno:
    build:
      context: infra/compose/inferno
      dockerfile: Dockerfile
    profiles: ["conformance"]
    platform: linux/amd64
    depends_on:
      interop:
        condition: service_healthy
    environment:
      FHIR_BASE_URL: http://interop:8080/fhir
    ports:
      - "4567:4567"
```

- [ ] **Step 3: Validate compose config**

```bash
docker compose -f infra/compose/docker-compose.yml config --quiet
```

Expected: exits 0 (no validation errors).

- [ ] **Step 4: Commit**

```bash
git add infra/compose/docker-compose.yml
git commit -m "fix(compose): replace stale inferno image with custom build; add depends_on interop"
```

---

### Task 5: Create conformance compose override

The conformance override enables `ConformanceTestAuthFilter` so Inferno can authenticate with a static bearer token without a full OAuth dance. This override is **never** applied outside the `make conformance` target.

**Files:**
- Create: `infra/compose/docker-compose.conformance.yml`

- [ ] **Step 1: Create the override file**

Create `infra/compose/docker-compose.conformance.yml`:
```yaml
# Conformance test overlay — applied ONLY by `make conformance`.
# NEVER apply in staging or production.
# Enables ConformanceTestAuthFilter (static bearer token; no OAuth).
services:
  interop:
    environment:
      INTEROP_CONFORMANCE_TEST_MODE: "true"
      INTEROP_CONFORMANCE_TEST_TOKEN: "conformance-test-token"
```

- [ ] **Step 2: Validate merged config**

```bash
docker compose \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.conformance.yml \
  config --quiet
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add infra/compose/docker-compose.conformance.yml
git commit -m "feat(conformance): compose override enabling ConformanceTestAuthFilter static token"
```

---

### Task 6: Wire `make conformance`

Replace the stub `conformance` target with a real implementation. Suite IDs come from the `bundle exec inferno suites` output captured in Task 3 Step 3.

**Files:**
- Modify: `Makefile:49-51`

- [ ] **Step 1: Discover the real Inferno CLI suite-run syntax**

After Task 3, run:
```bash
docker run --rm --platform linux/amd64 --entrypoint bundle \
  enstellar-inferno-test:local \
  exec inferno help suite run
```

Record the actual flag names (the spec uses `--suite`, `--url`, `--bearer-token`, `--output` as approximations — the real flags may differ slightly).

- [ ] **Step 2: Replace the conformance Makefile target**

Replace lines 49–51 in `Makefile`:
```makefile
## Run FHIR conformance tests (Inferno/Touchstone). Requires make up.
conformance:
	@echo "→ No conformance tests yet. Inferno/Touchstone wired in T05/T06."
```

With (substituting `<US_CORE_SUITE_ID>` and `<PAS_SUITE_ID>` from Task 3, and real CLI flags from Step 1):

```makefile
COMPOSE_CONFORMANCE := docker compose -f $(COMPOSE_FILE) -f infra/compose/docker-compose.conformance.yml

## Run FHIR conformance suites (US Core 5.0.1 + PAS 2.0.1) against the interop service.
## Builds the custom Inferno image on first run (cached thereafter).
## Results written to /tmp/inferno-*.json. Exits non-zero on any suite failure.
conformance:
	$(COMPOSE_CONFORMANCE) up -d --profile conformance --build --wait
	$(COMPOSE_CONFORMANCE) exec -T inferno bundle exec inferno suite run \
	  --suite <US_CORE_SUITE_ID> \
	  --url http://interop:8080/fhir \
	  --bearer-token conformance-test-token \
	  --output /tmp/inferno-us-core.json || ($(COMPOSE_CONFORMANCE) down -v && exit 1)
	$(COMPOSE_CONFORMANCE) exec -T inferno bundle exec inferno suite run \
	  --suite <PAS_SUITE_ID> \
	  --url http://interop:8080/fhir \
	  --bearer-token conformance-test-token \
	  --output /tmp/inferno-pas.json || ($(COMPOSE_CONFORMANCE) down -v && exit 1)
	docker cp $$(docker compose -f $(COMPOSE_FILE) ps -q inferno):/tmp/inferno-us-core.json /tmp/inferno-us-core.json 2>/dev/null || true
	docker cp $$(docker compose -f $(COMPOSE_FILE) ps -q inferno):/tmp/inferno-pas.json /tmp/inferno-pas.json 2>/dev/null || true
	$(COMPOSE_CONFORMANCE) down -v
```

Also add `COMPOSE_CONFORMANCE` to the `.PHONY` line and the Makefile header variables section.

- [ ] **Step 3: Verify make conformance runs without error**

```bash
make conformance
```

Expected: full stack comes up, both suites run against `http://interop:8080/fhir`, results appear in `/tmp/inferno-us-core.json` and `/tmp/inferno-pas.json`, stack tears down, exit code 0.

If a suite has actual conformance failures (not infrastructure failures), those are real findings and must be fixed or suppressed with documented justification before this gate can be called green.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(conformance): wire make conformance — Inferno US Core + PAS suites against interop"
```

---

## STREAM B — SP5: Security Scan

### Task 7: Add OWASP Dependency Check to Gradle

The JVM dependency scan uses the OWASP Dependency Check Gradle plugin. This task adds the plugin and configures it to fail on HIGH+ CVEs. An NVD API key is required to avoid rate-limiting on the NVD vulnerability database.

**Files:**
- Modify: `services/interop/build.gradle.kts`

- [ ] **Step 1: Obtain an NVD API key**

Register at `https://nvd.nist.gov/developers/request-an-api-key`. The key is needed in Step 3 and must be stored as a GitHub Actions secret named `NVD_API_KEY`. For local runs, export it: `export NVD_API_KEY=<your-key>`. Without it, the plugin falls back to unauthenticated access (heavily rate-limited, very slow).

- [ ] **Step 2: Add the plugin to `services/interop/build.gradle.kts`**

Add to the `plugins {}` block at the top of the file:
```kotlin
id("org.owasp.dependencycheck") version "10.0.3"
```

Add this configuration block after the existing `dependencies {}` block:
```kotlin
dependencyCheck {
    failBuildOnCVSS = 7.0f          // CVSS 7.0+ = HIGH or CRITICAL
    suppressionFile = "dependency-check-suppress.xml"
    nvd {
        apiKey = System.getenv("NVD_API_KEY") ?: ""
    }
    analyzers {
        assemblyEnabled = false     // no .NET on this JVM project
        nodeEnabled = false         // JS scanned separately via npm audit
    }
}
```

- [ ] **Step 3: Create the suppression file**

Create `services/interop/dependency-check-suppress.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
    <!--
    Add suppressions here following the pattern:
    <suppress until="YYYY-MM-DD">
        <notes>CVE-XXXX-NNNNN: justification — expires YYYY-MM-DD</notes>
        <cve>CVE-XXXX-NNNNN</cve>
    </suppress>
    -->
</suppressions>
```

- [ ] **Step 4: Test the plugin runs**

```bash
cd services/interop
NVD_API_KEY=<your-key> ./gradlew dependencyCheckAnalyze --info 2>&1 | tail -20
```

Expected: downloads NVD data (first run only, ~2 min), produces `build/reports/dependency-check-report.html`, exits 0 (assuming no HIGH+ CVEs in the current dependency tree). If there are HIGH+ findings, either fix them (upgrade the dependency) or add a suppression entry to `dependency-check-suppress.xml` with a justification and expiry date.

- [ ] **Step 5: Commit**

```bash
git add services/interop/build.gradle.kts services/interop/dependency-check-suppress.xml
git commit -m "feat(security): add OWASP Dependency Check plugin to interop Gradle build"
```

---

### Task 8: Create Semgrep config

**Files:**
- Create: `.semgrep.yml`

- [ ] **Step 1: Install Semgrep locally**

```bash
pip install semgrep
semgrep --version
```

Expected: prints a version string (≥ 1.70.0).

- [ ] **Step 2: Create the Semgrep config**

Create `.semgrep.yml` at the repo root:
```yaml
# Semgrep project configuration.
# `semgrep scan --config .semgrep.yml` uses the auto ruleset
# (community rules matching the languages in this repo).
# Inline suppressions: add `# nosemgrep: <rule-id>` with a justification comment.

rules: []  # project-specific rules go here; auto rules are loaded via --config auto

paths:
  exclude:
    - packages/canonical-model/generated/
    - infra/compose/mocks/
    - "**/*.min.js"
    - "apps/web/dist/"
    - ".gradle/"
    - "build/"
    - "**/__pycache__/"
```

- [ ] **Step 3: Run a test scan and review findings**

```bash
semgrep scan --config auto --config .semgrep.yml \
  --severity ERROR --severity WARNING \
  --output /tmp/semgrep-test.sarif --sarif \
  --no-git-ignore
```

Review `/tmp/semgrep-test.sarif`. For any finding that is a true positive: fix it. For any false positive: add `# nosemgrep: <rule-id>  # justification` on the offending line. Do not suppress entire files.

- [ ] **Step 4: Commit**

```bash
git add .semgrep.yml
git commit -m "feat(security): add Semgrep project config"
```

---

### Task 9: Configure gitleaks and establish baseline

**Files:**
- Create: `.gitleaks.toml`
- Create: `.gitleaks-baseline.json`

- [ ] **Step 1: Install gitleaks**

```bash
# macOS:
brew install gitleaks
# Or via script (Linux/CI):
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh | sh -s -- -b /usr/local/bin
gitleaks version
```

Expected: prints version ≥ 8.18.

- [ ] **Step 2: Create the gitleaks config**

Create `.gitleaks.toml` at the repo root:
```toml
title = "Enstellar gitleaks config"

[allowlist]
  description = "Baseline established 2026-06-09"
  paths = [
    # Test fixtures and mock data — not real secrets
    '''^infra/compose/mocks/''',
    # Conformance test token is intentionally a static string
    '''^infra/compose/docker-compose\.conformance\.yml$''',
  ]
```

- [ ] **Step 3: Generate the baseline**

A baseline captures all pre-existing findings so the gate only fails on new secrets introduced after this point.

```bash
gitleaks detect \
  --source . \
  --config .gitleaks.toml \
  --report-format json \
  --report-path .gitleaks-baseline.json \
  --no-git 2>/dev/null || true
```

Review `.gitleaks-baseline.json`. Each entry is a finding in the git history. Confirm all findings are either:
- Already rotated/revoked (acceptable in baseline), OR
- False positives (add the file pattern to `.gitleaks.toml`'s `allowlist.paths`).

Rotate any live secrets found before committing.

- [ ] **Step 4: Verify the baseline suppresses existing findings**

```bash
gitleaks detect \
  --source . \
  --config .gitleaks.toml \
  --baseline-path .gitleaks-baseline.json
```

Expected: exits 0 (no new findings beyond the baseline).

- [ ] **Step 5: Commit**

```bash
git add .gitleaks.toml .gitleaks-baseline.json
git commit -m "feat(security): gitleaks config + baseline (pre-existing findings captured)"
```

---

### Task 10: Create Trivy and pip-audit suppression stubs

**Files:**
- Create: `.trivyignore`
- Create: `pip-audit-ignore.txt`

- [ ] **Step 1: Create `.trivyignore`**

Create `.trivyignore` at the repo root:
```
# Trivy CVE suppression file.
# Format: one CVE-ID per line, with a required comment on the PRECEDING line.
# Required comment format: # <CVE>: <justification> — expires <YYYY-MM-DD>
# Undated suppressions will be flagged by `make scan-lint-suppressions`.
#
# Example:
# CVE-2024-12345: affects feature not used in this build — expires 2026-12-31
# CVE-2024-12345
```

- [ ] **Step 2: Create `pip-audit-ignore.txt`**

Create `pip-audit-ignore.txt` at the repo root:
```
# pip-audit vulnerability suppression file.
# One PYSEC or CVE ID per line, with required justification comment above.
# Required format: # <ID>: <justification> — expires <YYYY-MM-DD>
#
# Example:
# PYSEC-2024-12345: affects optional feature unused in this service — expires 2026-12-31
# PYSEC-2024-12345
```

- [ ] **Step 3: Commit**

```bash
git add .trivyignore pip-audit-ignore.txt
git commit -m "feat(security): Trivy and pip-audit suppression stubs"
```

---

### Task 11: Wire `make scan` and create SUPPRESSION.md

**Files:**
- Modify: `Makefile:53-55`
- Create: `docs/security/SUPPRESSION.md`

- [ ] **Step 1: Discover Docker Compose image names**

After building the stack, find the actual image names used by the first-party services:

```bash
make up
docker image ls | grep -E "interop|workflow|agent|bff|web" | grep -v "hapi\|postgres\|redpanda\|minio\|keycloak\|ollama\|opensearch\|redis"
```

Record the image names (format: `<project>-<service>:latest`, where `<project>` defaults to the repo directory name in lowercase, e.g. `enstellar`). You will need these in Step 2.

- [ ] **Step 2: Replace the scan Makefile target**

Replace lines 53–55 in `Makefile`:
```makefile
## Run security scans (SAST, secrets, dependency).
scan:
	@echo "→ No security scans yet. Wire in T01.1 (CI hardening)."
```

With (substitute real image names from Step 1 in `scan-images`):
```makefile
## Run all security scans: SAST, secrets, dependencies, container images.
## Fails on any HIGH or CRITICAL finding. See docs/security/SUPPRESSION.md for suppression guidance.
scan: scan-sast scan-secrets scan-deps scan-images

## SAST scan via Semgrep (auto ruleset + project rules).
scan-sast:
	semgrep scan --config auto --config .semgrep.yml \
	  --severity ERROR --severity WARNING \
	  --output /tmp/semgrep.sarif --sarif

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
## Builds images first via docker compose. Replace <image-names> with the actual names from `docker image ls`.
scan-images:
	$(COMPOSE) build
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-interop.json \
	  <INTEROP_IMAGE_NAME>
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-workflow.json \
	  <WORKFLOW_ENGINE_IMAGE_NAME>
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-agents.json \
	  <AGENT_LAYER_IMAGE_NAME>
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-bff.json \
	  <PORTAL_BFF_IMAGE_NAME>
	trivy image --severity HIGH,CRITICAL --exit-code 1 \
	  --ignorefile .trivyignore \
	  --format json --output /tmp/trivy-web.json \
	  <WEB_IMAGE_NAME>
```

Substitute the five `<..._IMAGE_NAME>` placeholders with the real names from Step 1.

Also add all new targets to the `.PHONY` line at the top of the Makefile: `scan-sast scan-secrets scan-deps scan-deps-python scan-deps-jvm scan-deps-npm scan-images`.

- [ ] **Step 3: Install scan tools locally and run each sub-target in isolation**

Install tools:
```bash
pip install semgrep pip-audit
brew install gitleaks trivy   # macOS; see Task 9 Step 1 for Linux
```

Run each sub-target individually and triage findings before running `make scan`:

```bash
make scan-sast       # fix true positives, suppress false positives with # nosemgrep:
make scan-secrets    # should exit 0 (baseline established in Task 9)
make scan-deps       # fix HIGH+ dep vulns or add to suppression files with justification
make scan-images     # fix HIGH+ image CVEs or add to .trivyignore with justification and expiry
```

For any HIGH+ finding you cannot immediately fix: add a suppression with a justification comment and expiry date per `docs/security/SUPPRESSION.md` (written in the next step). All suppressions must be reviewed and approved before merge.

- [ ] **Step 4: Run the full `make scan` and verify it exits 0**

```bash
make scan
echo "Exit code: $?"
```

Expected: all sub-targets pass, exit code 0.

- [ ] **Step 5: Create suppression documentation**

Create `docs/security/SUPPRESSION.md`:
```markdown
# Security Suppression Guide

`make scan` runs four tool classes. Each has its own suppression mechanism.
All suppressions require a **justification** and an **expiry date**.

## Semgrep (SAST)

Add `# nosemgrep: <rule-id>  # justification — expires YYYY-MM-DD` on the line with the finding.

```python
password = os.getenv("DB_PASSWORD")  # nosemgrep: python.django.security.audit.raw-query  # env-only, no user input — expires 2027-01-01
```

## gitleaks (secrets)

Add a path pattern to `.gitleaks.toml`'s `[allowlist]` block:

```toml
[allowlist]
  paths = [
    '''^path/to/false-positive-file$''',
  ]
```

Rotate any live secret before adding it to the allowlist. Re-run `gitleaks detect --report-path .gitleaks-baseline.json` to update the baseline.

## pip-audit (Python dependencies)

Add to `pip-audit-ignore.txt`:

```
# PYSEC-2024-12345: CVE description — justification — expires 2027-01-01
PYSEC-2024-12345
```

## Trivy (container images and JVM)

Add to `.trivyignore`:

```
# CVE-2024-12345: CVE description — justification — expires 2027-01-01
CVE-2024-12345
```

## OWASP Dependency Check (JVM)

Add to `services/interop/dependency-check-suppress.xml`:

```xml
<suppress until="2027-01-01">
    <notes>CVE-XXXX-NNNNN: justification</notes>
    <cve>CVE-XXXX-NNNNN</cve>
</suppress>
```

## Expiry discipline

Suppressions without expiry dates are **not accepted**. Review suppressions before their expiry date. Expired suppressions that are still needed must be renewed with a new justification.
```

- [ ] **Step 6: Commit**

```bash
git add Makefile docs/security/SUPPRESSION.md
git commit -m "feat(security): wire make scan (SAST/secrets/deps/images) + suppression guide"
```

---

## SHARED — Task 12: Nightly CI workflow

This task depends on both streams being locally verified (Tasks 6 and 11 passing). The workflow references `make conformance` and `make scan` — both must exit 0 before this is committed.

**Files:**
- Create: `.github/workflows/nightly.yml`

- [ ] **Step 1: Confirm NVD_API_KEY secret is set in GitHub**

Go to `Settings → Secrets and variables → Actions` and add `NVD_API_KEY` with the key obtained in Task 7 Step 1. The `scan-deps-jvm` step will be very slow without it (rate-limited NVD access).

- [ ] **Step 2: Create the nightly workflow**

Create `.github/workflows/nightly.yml`:
```yaml
name: Nightly gates

on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
  workflow_dispatch:       # allows manual trigger from Actions UI

jobs:
  conformance:
    name: FHIR conformance (US Core 5.0.1 + PAS 2.0.1)
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
          if-no-files-found: warn
          retention-days: 30

      - name: Tear down stack
        if: always()
        run: |
          docker compose \
            -f infra/compose/docker-compose.yml \
            -f infra/compose/docker-compose.conformance.yml \
            down -v --remove-orphans

  security-scan:
    name: Security & supply-chain scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # gitleaks requires full git history

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

      - uses: astral-sh/setup-uv@v4
        with:
          version: "latest"

      - name: Install scan tools
        run: |
          pip install semgrep pip-audit
          curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh \
            | sh -s -- -b /usr/local/bin v8.18.4
          curl -sSfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
            | sh -s -- -b /usr/local/bin v0.52.2

      - name: Install web deps (for npm audit)
        run: cd apps/web && npm ci

      - name: Run security scans
        env:
          NVD_API_KEY: ${{ secrets.NVD_API_KEY }}
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
          if-no-files-found: warn
          retention-days: 30
```

- [ ] **Step 3: Dry-run validate the workflow file**

```bash
# Install actionlint if available:
brew install actionlint  # macOS
actionlint .github/workflows/nightly.yml
```

Expected: no errors. If actionlint is unavailable, validate manually by checking YAML syntax:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/nightly.yml'))" && echo "Valid YAML"
```

- [ ] **Step 4: Trigger a manual run to verify both jobs pass**

Push the branch, go to Actions → Nightly gates → Run workflow. Both `conformance` and `security-scan` jobs should pass and upload artifacts. Fix any failures before marking this task done.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/nightly.yml
git commit -m "feat(ci): nightly conformance + security scan gates (schedule + workflow_dispatch)"
```

---

## Self-review against spec

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| Flip `proxy-enabled` default to `true` | Task 1 |
| Custom Inferno image with US Core 5.0.1 + PAS 2.0.1 gems | Task 3 |
| `bundle exec inferno suites` at build time (verify CLI + suite IDs) | Task 3 Step 3 |
| Replace stale `infernoframework/inferno-core:latest` reference | Task 4 |
| `inferno` `depends_on: [interop]` | Task 4 |
| `docker-compose.conformance.yml` override (conformance token, never staging/prod) | Task 5 |
| `make conformance` exits non-zero on suite failure | Task 6 |
| Results archived to `/tmp/inferno-*.json` | Task 6 |
| OWASP Dependency Check for JVM | Task 7 |
| Semgrep SAST | Task 8 |
| gitleaks + baseline | Task 9 |
| `.trivyignore` and `pip-audit-ignore.txt` stubs | Task 10 |
| `make scan` sub-targets (sast / secrets / deps / images) | Task 11 |
| Suppression mechanism documented | Task 11 Step 5 |
| No HIGH+ unaddressed findings on initial run | Task 11 Step 3–4 |
| Single `nightly.yml`, parallel jobs, `workflow_dispatch` | Task 12 |
| 30-day artifact retention | Task 12 |
| NVD API key wired as secret | Task 12 Step 1 |

All spec requirements are covered. No gaps.
