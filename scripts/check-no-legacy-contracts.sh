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
