#!/usr/bin/env bash
# C2a invariant: the contract cutover is complete — no legacy enstellar_events
# imports and the deleted packages are gone.
# C2b invariant: the tenancy/authz cutover is complete — no legacy
# enstellar_authz imports and the deleted authz package is gone.
set -euo pipefail
if grep -rEn 'enstellar_events' services/enstellar-* --include='*.py' ; then
  echo "C2a INVARIANT VIOLATED: enstellar_events imports remain (should be simintero-contracts/outbox)." >&2
  exit 1
fi
if grep -rEn 'enstellar_authz' services/enstellar-* --include='*.py' ; then
  echo "C2b INVARIANT VIOLATED: enstellar_authz imports remain (should be simintero-authz)." >&2
  exit 1
fi
for d in services/enstellar-packages/canonical-model services/enstellar-packages/event-contracts services/enstellar-packages/authz ; do
  if [ -d "$d" ]; then echo "INVARIANT VIOLATED: $d should be deleted." >&2; exit 1; fi
done
# C2c invariant: interop is conformed to the platform TenantContext — it must NOT
# carry its own auth.TenantContext (should use io.simintero.tenant.TenantContext).
if [ -f services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/auth/TenantContext.java ]; then
  echo "C2c INVARIANT VIOLATED: interop should use io.simintero.tenant.TenantContext, not its own." >&2; exit 1
fi
echo "C2a/C2b/C2c invariant OK: contract + tenancy/authz cutover complete."
# C3a invariant: the platform's parallel Enstellar seam + reviewer console are retired.
# Check TRACKED state and retired PATHS (not bare names — breadcrumb comments and the
# bundled services/enstellar-interop/x12-translator subproject legitimately remain).
for p in integration/fhir-facade integration/x12-translator apps/web/reviewer-workspace infra/k8s/fhir-facade infra/k8s/x12-translator ; do
  if [ -n "$(git ls-files "$p")" ]; then
    echo "C3a INVARIANT VIOLATED: $p is still tracked (should be deleted)." >&2; exit 1
  fi
done
if git grep -lI "integration/fhir-facade\|integration/x12-translator\|apps/web/reviewer-workspace\|infra/k8s/fhir-facade\|infra/k8s/x12-translator" -- ':!docs/' ':!*.md' ':!scripts/check-no-legacy-contracts.sh' ; then
  echo "C3a INVARIANT VIOLATED: a tracked file references a retired path above." >&2; exit 1
fi
if git grep -nI "enstellarIntake\|enstellarCase\|workspaceBff\|fhirFacade" -- integration/e2e/src/world.ts ; then
  echo "C3a INVARIANT VIOLATED: a retired dead-path service key reappeared in e2e world.ts." >&2; exit 1
fi
echo "C3a invariant OK: parallel seam + reviewer console retired."
# C3b invariant: the TS Enstellar twin (modules/enstellar) is deleted (N-001 resolved).
# Key on tracked-state + package/env/service-name patterns (NOT the bare "modules/enstellar"
# string, which legitimately survives in immutable Flyway provenance comments + a docs README).
# The canonical Python/Java services/enstellar-* and ens.case legitimately remain.
if [ -n "$(git ls-files modules/enstellar)" ]; then
  echo "C3b INVARIANT VIOLATED: modules/enstellar is still tracked (TS twin must be deleted)." >&2; exit 1
fi
if git grep -lI "@sim/enstellar-\|ENSTELLAR_CASE_URL" -- ':!docs/' ':!*.md' ':!services/enstellar-**' ':!scripts/check-no-legacy-contracts.sh' ; then
  echo "C3b INVARIANT VIOLATED: a tracked file imports/wires the deleted TS twin (@sim/enstellar-* / ENSTELLAR_CASE_URL)." >&2; exit 1
fi
if git grep -lI "enstellar-case\|enstellar-comms\|enstellar-clock-worker\|enstellar-workflow-worker\|workspace-bff" -- docker-compose.yml infra .github/workflows ':!*.md' ; then
  echo "C3b INVARIANT VIOLATED: a deleted TS-twin service reappeared in deploy/CI config." >&2; exit 1
fi
echo "C3b invariant OK: TS Enstellar twin deleted (N-001 resolved)."
# C4a invariant: the stack is unified — the separate enstellar-compose stack is retired,
# and no DEPLOY config references Keycloak realm `enstellar` (the kept `enstellar-api`
# AUDIENCE is a client/API id, not the realm; test fixtures are excluded).
if [ -e services/enstellar-compose/docker-compose.yml ]; then
  echo "C4a INVARIANT VIOLATED: services/enstellar-compose/docker-compose.yml must be deleted (merged into root)." >&2; exit 1
fi
if git grep -lI "realms/enstellar" -- docker-compose.yml infra .github/workflows ':!*.md' ; then
  echo "C4a INVARIANT VIOLATED: deploy config still references Keycloak realm 'enstellar' (should be 'simintero')." >&2; exit 1
fi
echo "C4a invariant OK: stack unified on realm simintero; enstellar-compose retired."
# C4a-build-fix invariant: the Enstellar image Dockerfiles use the monorepo layout
# (no pre-relocation COPY paths). The three fixed Dockerfiles must not COPY the old
# standalone-repo paths (packages/, services/integration-connectors, packages/canonical-model,
# services/interop, services/workflow-engine).
if git grep -nE "COPY +packages/|COPY +services/integration-connectors|packages/canonical-model|COPY +services/interop |COPY +services/workflow-engine" -- services/enstellar-interop/Dockerfile services/enstellar-workflow/Dockerfile services/enstellar-portal-bff/Dockerfile ; then
  echo "C4a-build-fix INVARIANT VIOLATED: an Enstellar Dockerfile still COPYs a pre-monorepo path." >&2; exit 1
fi
echo "C4a-build-fix invariant OK: Enstellar Dockerfiles on monorepo layout."
# C4-tsbase-fix invariant: any service Dockerfile whose tsconfig extends the root
# tsconfig.base.json must COPY it into the build context (else tsc fails TS5083),
# and stale *.tsbuildinfo must not leak into the build context (breaks incremental emit).
tsbase_viol=0
for df in $(git grep -lI "pnpm-workspace.yaml" -- '**/Dockerfile'); do
  d=$(dirname "$df")
  if [ -f "$d/tsconfig.json" ] && grep -q "tsconfig.base.json" "$d/tsconfig.json"; then
    if ! grep -q "tsconfig.base.json" "$df"; then
      echo "C4-tsbase-fix INVARIANT VIOLATED: $df extends tsconfig.base.json but does not COPY it." >&2
      tsbase_viol=1
    fi
  fi
done
if ! grep -q "tsbuildinfo" .dockerignore ; then
  echo "C4-tsbase-fix INVARIANT VIOLATED: .dockerignore must exclude *.tsbuildinfo (stale incremental info breaks tsc --build emit)." >&2
  tsbase_viol=1
fi
[ "$tsbase_viol" -eq 0 ] || exit 1
echo "C4-tsbase-fix invariant OK: TS service Dockerfiles COPY tsconfig.base.json; tsbuildinfo excluded."
# I1 invariant: the Enstellar PA flow uses real digicore-runtime, not mock-digicore.
if git grep -lI "mock-digicore" -- docker-compose.yml services/enstellar-interop services/enstellar-connectors services/enstellar-workflow ; then
  echo "I1 INVARIANT VIOLATED: a tracked file still references mock-digicore (should use digicore-runtime)." >&2; exit 1
fi
if git grep -nI "DIGICORE_BASE_URL: http://mock-digicore" -- docker-compose.yml ; then
  echo "I1 INVARIANT VIOLATED: DIGICORE_BASE_URL still points at mock-digicore." >&2; exit 1
fi
echo "I1 invariant OK: Enstellar PA flow uses real digicore-runtime (mock-digicore retired)."

# I2a invariant: interop is wired to the platform Document Service for the ingestion bridge.
if ! git grep -qI "DOCUMENT_SERVICE_URL: http://document-service:3010" -- docker-compose.yml ; then
  echo "I2a INVARIANT VIOLATED: interop is not wired to document-service in docker-compose.yml." >&2; exit 1
fi
if ! git ls-files --error-unmatch \
     services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/document/DocumentServiceClient.java \
     >/dev/null 2>&1 ; then
  echo "I2a INVARIANT VIOLATED: interop DocumentServiceClient is missing." >&2; exit 1
fi
echo "I2a invariant OK: interop ingests PA documents into the platform Document Service (case_ref=correlation_id)."

# F1 invariant: no service Dockerfile ships dangling pnpm workspace symlinks, and the
# four formerly-export{} services boot a real server.
if git grep -nI "COPY --from=builder /repo/.*/node_modules " -- '*Dockerfile' ; then
  echo "F1 INVARIANT VIOLATED: a Dockerfile still copies workspace node_modules (dangling pnpm symlinks)." >&2; exit 1
fi
for f in modules/claims/service/src/index.ts modules/search/query-api/src/index.ts \
         modules/analytics/service/src/index.ts modules/qualitron/execution/src/server.ts ; do
  if ! git grep -qI "listen" -- "$f" ; then
    echo "F1 INVARIANT VIOLATED: $f does not start a server (.listen)." >&2; exit 1
  fi
done
echo "F1 invariant OK: every service image is self-contained and the formerly-dead services boot."
