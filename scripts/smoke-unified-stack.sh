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
DOCS_URL=${DOCS_URL:-http://localhost:3010}

# Tenant the smoke user (md-reviewer) carries via the realm-simintero tenant_id claim;
# the bundle id is the PAS correlation id. Both are reused below so the I2a bridge
# query (case_ref + x-sim-tenant-id) matches exactly what $submit stored.
TENANT_ID=${TENANT_ID:-tenant-dev}
CORRELATION_ID=${CORRELATION_ID:-smoke-pas-bundle-001}

echo "── 1. compose config validates ──"
docker compose config -q
echo "  compose config OK"

echo "── 2. bring up the stack (waits for healthchecks) ──"
# NOTE: We bring up an EXPLICIT service list (the Enstellar PAS path) rather than
# the whole stack. A bare `docker compose up -d --wait` would try to build ALL
# `build:` services, and 7 platform-TS services (analytics, automation, document,
# market-bundles, model-gateway, qualitron, search) currently fail to build —
# their Dockerfiles don't `COPY tsconfig.base.json`. That is a separate,
# pre-existing issue tracked as a follow-up and is NOT on the PAS round-trip path.
# The list below is the dependency closure for the PAS path; compose auto-includes
# `depends_on` (e.g. interop → hapi), and none of those deps are the broken 7.
docker compose up -d --wait \
  postgres keycloak redpanda minio opa \
  digicore-runtime document-service \
  interop workflow-engine portal-bff \
  temporal revital-pipeline revital-worker model-gateway \
  vkas mock-llm

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
#
# KNEE CASE (I1 real-digicore proof): the Claim line uses CPT 27447 (total knee
# arthroplasty). interop's PasBundleMapper maps Claim.item.productOrService CPT
# → ServiceLine.procedure_code, which workflow's auto-determination sends to the
# REAL digicore-runtime as DecisionRequest.service_code. digicore-runtime's C-1
# stub (CoverageDiscoveryController/EvaluateController) keys auto-determination on
# procedure_code=="27447" (or service_code containing "knee"), so 27447 exercises
# the real coverage-discovery + evaluate path — NOT the retired mock-digicore.
# The $submit response is synchronous QUEUED; the digicore evaluate happens async
# in workflow-engine, so this step asserts only the accepted round-trip.
# NOTE: the canonical-model normalizer (PasBundleMapper) hard-requires a couple
# of fields the bare PAS shape doesn't: Patient.birthDate, and an NPI identifier
# (system http://hl7.org/fhir/sid/us-npi) on the requesting Practitioner. Without
# them interop's $submit returns 400 "Normalization rejected bundle". They're
# included below so this is a real, accepted round-trip.
PAS_BUNDLE='{"resourceType":"Bundle","id":"'"$CORRELATION_ID"'","type":"collection","entry":[{ "resource": { "resourceType": "Binary", "contentType": "application/pdf", "data": "JVBERi0xLjQK" } },{"resource":{"resourceType":"Claim","id":"claim-001","use":"preauthorization","status":"active","patient":{"reference":"Patient/pat-001"},"provider":{"reference":"Practitioner/pract-001"},"insurance":[{"sequence":1,"focal":true,"coverage":{"reference":"Coverage/cov-001"}}],"diagnosis":[{"sequence":1,"diagnosisCodeableConcept":{"coding":[{"system":"http://hl7.org/fhir/sid/icd-10-cm","code":"M54.5","display":"Low back pain"}]}}],"item":[{"sequence":1,"productOrService":{"coding":[{"system":"http://www.ama-assn.org/go/cpt","code":"27447","display":"Total knee arthroplasty"}]},"diagnosisSequence":[1]}]}},{"resource":{"resourceType":"Patient","id":"pat-001","name":[{"family":"Smith","given":["Jane"]}],"gender":"female","birthDate":"1980-01-15"}},{"resource":{"resourceType":"Practitioner","id":"pract-001","identifier":[{"system":"http://hl7.org/fhir/sid/us-npi","value":"1234567893"}],"name":[{"family":"Jones","given":["Bob"]}]}},{"resource":{"resourceType":"Coverage","id":"cov-001","payor":[{"display":"ACME Health Plan"}]}}]}'
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

echo "--- I2a: document retrievable by case_ref ---"
DOCS=$(curl -s -H "x-sim-tenant-id: ${TENANT_ID}" \
  "${DOCS_URL}/documents?case_ref=${CORRELATION_ID}")
echo "documents: ${DOCS}"
if echo "${DOCS}" | grep -q '"doc_id"'; then
  echo "✅ I2a bridge: document ingested and retrievable by correlation_id"
else
  echo "❌ I2a bridge: no document found for case_ref=${CORRELATION_ID}" >&2
  exit 1
fi

echo "── 7. case surfaces in portal-bff worklist ──"
# queue_id "default" → all tenant cases (worklist_router), so this is a stable 200.
curl -sf "$BFF/bff/queues/default/worklist" -H "Authorization: Bearer $TOKEN" -o /dev/null \
  && echo "  worklist OK"

echo "── 8. F2: case advances through the event plane to clinical_review ──"
# After $submit, normalize creates the case + kicks off auto_determination; the
# OutboxRelay drains shared.outbox → Kafka; the consumers carry the case
# auto_determination → (digicore pending_review) → clinical_review. We poll the
# workflow DB directly for OUR correlation_id and assert it reaches clinical_review.
# (The DB is the most direct proof of the event plane; the reviewer worklist is a
# separate RBAC'd surface — md-reviewer lacks the reviewer role — so we don't use it here.)
F2_STATUS=""
for i in $(seq 1 30); do
  F2_STATUS=$(docker compose exec -T postgres psql -U sim -d workflow -tAc \
    "SELECT status FROM workflow_instances WHERE correlation_id='${CORRELATION_ID}' AND tenant_id='${TENANT_ID}';" \
    2>/dev/null | tr -d '[:space:]')
  echo "   poll $i: status='${F2_STATUS}'"
  [ "$F2_STATUS" = "clinical_review" ] && break
  sleep 2
done
if [ "$F2_STATUS" = "clinical_review" ]; then
  echo "✅ F2: case ${CORRELATION_ID} reached clinical_review (event plane live end-to-end)"
elif [ -n "$F2_STATUS" ] && [ "$F2_STATUS" != "intake" ]; then
  echo "⚠️  F2: case advanced past intake to '${F2_STATUS}' but not clinical_review" >&2
  exit 1
else
  echo "❌ F2: case ${CORRELATION_ID} did not advance past intake (status='${F2_STATUS}')" >&2
  exit 1
fi

echo "── 9. F3: revital analysis runs to a terminal status ──"
# Revital's /v1/assist/analyses is gated only by the x-sim-tenant-id header (no JWT).
# The Temporal worker executes the workflow → persistAdvisory writes a terminal row.
# Terminal status is 'complete' for this empty-document_refs request (inference activities are
# skipped, not errored); a real document-grounded request abstains to 'partial' until the AI
# inference stack (model-gateway/VKAS) lands in AI1. Either terminal value passes here.
REV_URL="http://localhost:3014"
ANA=$(curl -sf -X POST "$REV_URL/v1/assist/analyses" \
  -H "x-sim-tenant-id: $TENANT_ID" -H "Content-Type: application/json" \
  -d '{"case_ref":"'"$CORRELATION_ID"'","analysis_kinds":["summary","triage"],"inputs":{"document_refs":[],"case_context":{"lob":"MA","urgency":"standard","service_lines":[]}}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('analysis_id',''))" 2>/dev/null)
echo "   analysis_id=${ANA}"
if [ -z "$ANA" ]; then echo "❌ F3: submit did not return an analysis_id" >&2; exit 1; fi
REV_STATUS=""
for i in $(seq 1 30); do
  REV_STATUS=$(curl -sf "$REV_URL/v1/assist/analyses/$ANA" -H "x-sim-tenant-id: $TENANT_ID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo '')
  echo "   poll $i: status='${REV_STATUS}'"
  case "$REV_STATUS" in complete|partial|failed) break;; esac
  sleep 2
done
case "$REV_STATUS" in
  complete|partial)
    echo "✅ F3: revital analysis ${ANA} reached terminal status '${REV_STATUS}' (Temporal worker executed the pipeline)";;
  failed)
    echo "❌ F3: analysis reached 'failed' — the workflow ran but an activity errored (check revital-worker logs)" >&2; exit 1;;
  *)
    echo "❌ F3: analysis stuck at status='${REV_STATUS}' (expected terminal) — worker/namespace/taskQueue mismatch?" >&2; exit 1;;
esac

echo "── 10. AI1: model-gateway /inference returns structured output ──"
# After F3 the Revital pipeline runs but abstains without an inference backend.
# AI1 stands up VKAS (resolves the seeded shared model_binding) + a deterministic
# mock LLM; model-gateway parses the LLM string into a structured `output` object.
# We POST /inference for each task_kind and assert `output` is a dict carrying the
# kind's signature key (extract_entities→entities, summarize→assertions,
# triage_advise→suggestion). Path: VKAS resolve → mock-llm → JSON.parse.
MG_URL="http://localhost:3011"
ai1_check() {
  local kind="$1" expect_key="$2" body="$3"
  local out
  out=$(curl -sf -X POST "$MG_URL/inference" \
    -H "x-sim-tenant-id: $TENANT_ID" -H "x-sim-cell-boundary: pooled" -H "Content-Type: application/json" \
    -d "$body" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); o=d.get('output'); print('OBJ' if isinstance(o,dict) and ('$expect_key' in o) else 'BAD:'+str(type(o).__name__))" 2>/dev/null || echo "ERR")
  echo "   $kind → $out"
  [ "$out" = "OBJ" ] || { echo "❌ AI1: /inference($kind) did not return structured output" >&2; exit 1; }
}
ai1_check extract_entities entities \
  '{"task_kind":"extract_entities","prompt_ref":"p","prompt_version":"1.0.0","model_binding_ref":"https://artifacts.simintero.io/shared/model_binding/claude-pa","model_binding_version":"1.0.0","inputs":{"document_span_refs":["span-1"],"text_segments":["t"]},"workflow_id":"ai1-smoke"}'
ai1_check summarize assertions \
  '{"task_kind":"summarize","prompt_ref":"p","prompt_version":"1.0.0","model_binding_ref":"https://artifacts.simintero.io/shared/model_binding/claude-pa","model_binding_version":"1.0.0","inputs":{"document_span_refs":["span-1"]},"workflow_id":"ai1-smoke"}'
ai1_check triage_advise suggestion \
  '{"task_kind":"triage_advise","prompt_ref":"p","prompt_version":"1.0.0","model_binding_ref":"https://artifacts.simintero.io/shared/model_binding/claude-pa","model_binding_version":"1.0.0","inputs":{},"workflow_id":"ai1-smoke"}'
echo "✅ AI1: /inference returns structured output for all task_kinds (VKAS resolve → mock-llm → parsed)"

echo "── 11. I2b-1: clinical_review drives the real Revital advisory ──"
# The case reached clinical_review in step 8. The rewired ClinicalReviewConsumer
# resolved the I2a-ingested document, submitted a C-2 analysis to revital-pipeline,
# and recorded a revital_inflight row; RevitalPoller polls to a terminal status and
# (on complete/partial) maps the advisory + emits AGENT_ASSIST_PRODUCED. We poll the
# workflow DB for the in-flight row reaching 'done' and assert a produced (not failed)
# advisory event for OUR correlation_id. Per the acceptance bar the gate is
# "in-flight done + AgentAssistProduced", NOT a specific criteria row (the submit
# route sets evidence_requirements_ref=null, so completeness is null here).
I2B_STATUS=""
for i in $(seq 1 45); do
  I2B_STATUS=$(docker compose exec -T postgres psql -U sim -d workflow -tAc \
    "SELECT status FROM revital_inflight WHERE correlation_id='${CORRELATION_ID}' AND tenant_id='${TENANT_ID}' ORDER BY submitted_at DESC LIMIT 1;" \
    2>/dev/null | tr -d '[:space:]')
  echo "   poll $i: revital_inflight status='${I2B_STATUS}'"
  [ "$I2B_STATUS" = "done" ] && break
  sleep 2
done
if [ "$I2B_STATUS" != "done" ]; then
  echo "❌ I2b-1: revital_inflight did not reach 'done' (status='${I2B_STATUS}') — submit/poller path broken" >&2
  echo "   --- revital-worker logs ---" >&2; docker compose logs revital-worker 2>&1 | tail -30 >&2
  echo "   --- workflow-engine logs ---" >&2; docker compose logs workflow-engine 2>&1 | tail -30 >&2
  exit 1
fi
# Assert a produced (not failed) advisory event landed for this correlation_id.
PRODUCED=$(docker compose exec -T postgres psql -U sim -d workflow -tAc \
  "SELECT count(*) FROM shared.outbox WHERE envelope->>'correlation_id'='${CORRELATION_ID}' AND envelope->>'schema_ref'='sim.ai.interaction/AgentAssistProduced/v1';" \
  2>/dev/null | tr -d '[:space:]')
echo "   AgentAssistProduced events: ${PRODUCED}"
if [ "${PRODUCED:-0}" -ge 1 ]; then
  echo "✅ I2b-1: Revital advisory produced end-to-end (in-flight→done, AgentAssistProduced emitted)"
else
  echo "❌ I2b-1: in-flight done but no AgentAssistProduced — analysis failed/abstained, mapping not reached" >&2
  docker compose logs workflow-engine 2>&1 | tail -30 >&2
  exit 1
fi

echo "✅ unified-stack smoke PASSED"
