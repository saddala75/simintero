#!/usr/bin/env bash
# C1 invariant: Enstellar services have NOT yet adopted the platform conformance
# libs / contracts (that is strictly C2). Fail if any such import appears.
set -euo pipefail
if grep -rEn 'import +simintero_(contracts|tenant_context|outbox|authz)|from +simintero_(contracts|tenant_context|outbox|authz) +import' services/enstellar-* --include='*.py' ; then
  echo "C1 INVARIANT VIOLATED: services/enstellar-* must not import platform conformance libs yet (that is C2)." >&2
  exit 1
fi
echo "C1 invariant OK: no platform-lib adoption in enstellar services."
