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
