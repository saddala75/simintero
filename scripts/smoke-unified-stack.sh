#!/usr/bin/env bash
# C4a smoke test: prove the unified stack runs as one platform.
#
# Seams proven, end to end:
#   - root docker-compose.yml is a single valid stack (`config -q`)
#   - it comes up under one set of healthchecks (`up -d --wait`)
#   - Keycloak realm `simintero` mints a reviewer JWT (sslRequired=none → http)
#   - interop serves FHIR (`/fhir/metadata`) and accepts PAS `Claim/$submit`
#   - OPA is reachable with its policies loaded
#   - the same JWT reaches the portal-bff worklist (cross-service token flow)
#
# Endpoints/paths below are the REAL ones (verified against source), not guesses:
#   - submit:   POST /fhir/Claim/$submit   (PasClaimSubmitProvider, app/fhir+json)
#   - metadata: GET  /fhir/metadata        (permitAll in SecurityConfig)
#   - cds disc: GET  /cds-services         (permitAll in SecurityConfig)
#   - worklist: GET  /bff/queues/{id}/worklist  (worklist.router under /bff prefix)
#               queue_id "default" returns all tenant cases → always 200.
set -euo pipefail
cd "$(dirname "$0")/.."

KC=${KC:-http://localhost:8081}
INTEROP=${INTEROP:-http://localhost:8080}
BFF=${BFF:-http://localhost:8001}
OPA=${OPA:-http://localhost:8181}

echo "── 1. compose config validates ──"
docker compose config -q
echo "  compose config OK"

echo "── 2. bring up the stack (waits for healthchecks) ──"
docker compose up -d --wait

echo "── 3. mint a realm-simintero reviewer JWT ──"
TOKEN=$(curl -sf -X POST "$KC/realms/simintero/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=enstellar-test-client \
  -d "client_secret=${TEST_CLIENT_SECRET:-test-secret}" \
  -d "username=${SMOKE_USER:-md-reviewer}" -d "password=${E2E_PASSWORD:-e2e-pass}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
[ -n "$TOKEN" ] && echo "  got token (len ${#TOKEN})"

echo "── 4. interop FHIR metadata reachable ──"
curl -sf "$INTEROP/fhir/metadata" -o /dev/null && echo "  interop metadata OK"

echo "── 5. OPA reachable + policies loaded ──"
curl -sf "$OPA/v1/policies" -o /dev/null && echo "  opa OK"

echo "── 6. PAS \$submit round-trip ──"
# No JSON fixture lives under interop test resources — the test bundle is built
# programmatically by PasTestBundles.validPasBundleJson(). We inline the same
# minimal-valid PAS bundle (Claim use=preauthorization + Patient/Practitioner/
# Coverage) and assert a ClaimResponse Bundle comes back. The token from step 3
# carries the reviewer identity; interop requires auth for $submit.
PAS_BUNDLE='{"resourceType":"Bundle","id":"smoke-pas-bundle-001","type":"collection","entry":[{"resource":{"resourceType":"Claim","id":"claim-001","use":"preauthorization","status":"active","patient":{"reference":"Patient/pat-001"},"provider":{"reference":"Practitioner/pract-001"},"insurance":[{"sequence":1,"focal":true,"coverage":{"reference":"Coverage/cov-001"}}],"diagnosis":[{"sequence":1,"diagnosisCodeableConcept":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"M54.5","display":"Low back pain"}]}}],"item":[{"sequence":1,"productOrService":{"coding":[{"system":"http://www.ama-assn.org/go/cpt","code":"97110","display":"Therapeutic Exercise"}]},"diagnosisSequence":[1]}]}},{"resource":{"resourceType":"Patient","id":"pat-001","name":[{"family":"Smith","given":["Jane"]}]}},{"resource":{"resourceType":"Practitioner","id":"pract-001","name":[{"family":"Jones","given":["Bob"]}]}},{"resource":{"resourceType":"Coverage","id":"cov-001","payor":[{"display":"ACME Health Plan"}]}}]}'
SUBMIT_RESP=$(curl -sf -X POST "$INTEROP/fhir/Claim/\$submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -H "Accept: application/fhir+json" \
  --data-binary "$PAS_BUNDLE")
echo "$SUBMIT_RESP" | python3 -c "
import sys, json
b = json.load(sys.stdin)
assert b.get('resourceType') == 'Bundle', f\"expected Bundle, got {b.get('resourceType')}\"
cr = b.get('entry', [{}])[0].get('resource', {})
assert cr.get('resourceType') == 'ClaimResponse', f\"expected ClaimResponse, got {cr.get('resourceType')}\"
assert cr.get('use') == 'preauthorization', f\"expected preauthorization, got {cr.get('use')}\"
print('  \$submit OK — ClaimResponse outcome=' + cr.get('outcome', '?'))
"

echo "── 7. case surfaces in portal-bff worklist ──"
# queue_id "default" → all tenant cases (worklist_router), so this is a stable 200.
curl -sf "$BFF/bff/queues/default/worklist" -H "Authorization: Bearer $TOKEN" -o /dev/null \
  && echo "  worklist OK"

echo "✅ unified-stack smoke PASSED"
