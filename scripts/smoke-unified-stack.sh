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
  digicore-runtime document-service document-worker \
  interop workflow-engine portal-bff \
  temporal revital-pipeline revital-worker model-gateway \
  vkas mock-llm digicore-authoring digicore-governance qualitron task-service terminology-service relay

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

echo "── 7b. P0-0.4: ingest pipeline ran under RLS + bytes durable in MinIO ──"
DID=$(echo "$DOCS" | python3 -c "import sys,json; d=json.load(sys.stdin); docs=d.get('documents') if isinstance(d,dict) else d; print(docs[0]['doc_id'])")
[ -n "$DID" ] || { echo "❌ P0-0.4: no doc_id from the I2a list" >&2; exit 1; }
# the document-worker ran the activities under the GUC → virus_scan_status=clean + text_key set
ST=""; for i in $(seq 1 20); do
  ST=$(docker compose exec -T postgres psql -U sim -d simintero -tAc "SELECT virus_scan_status||'/'||coalesce(text_key,'-') FROM docs.document WHERE doc_id='$DID';")
  echo "$ST" | grep -q "clean/.\+" && break; sleep 1
done
echo "   pipeline status=$ST"
echo "$ST" | grep -q "clean/.\+" || { echo "❌ P0-0.4: ingest pipeline did not run (status=$ST)" >&2; docker compose logs document-worker 2>&1 | tail -30 >&2; exit 1; }
# emitDocumentReady ran under the GUC → a sim.evidence outbox row
EV=$(docker compose exec -T postgres psql -U sim -d simintero -tAc "SELECT count(*) FROM shared.outbox WHERE topic='sim.evidence' AND key='$DID';")
echo "   sim.evidence outbox rows=$EV"
[ "${EV:-0}" -ge 1 ] || { echo "❌ P0-0.4: no sim.evidence event for $DID" >&2; exit 1; }
# DURABILITY: fresh container (wipes /tmp; MinIO external) → content still readable
docker compose up -d --force-recreate --no-deps document-service >/dev/null 2>&1
docker compose up -d --wait document-service >/dev/null 2>&1
RB=$(curl -sS -o /dev/null -w "%{http_code}" "${DOCS_URL}/documents/$DID/span" -H "x-sim-tenant-id: ${TENANT_ID}")
echo "   readback after recreate=$RB"
[ "$RB" = "200" ] || { echo "❌ P0-0.4: content not durable after container recreate (readback=$RB)" >&2; docker compose logs document-service 2>&1 | tail -20 >&2; exit 1; }
echo "✅ P0-0.4: ingest pipeline ran under RLS + bytes durable in MinIO (survived container recreate)"

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

echo "── 10b. AI-OPS: model-ops eval gate (author candidate → activate 409 → eval-runner 3/3 → activate 200) ──"
# Proves the slice-2.2b gate: a model_binding cannot reach `active` without a passing
# gate='eval' approval produced by the real eval-runner. We author a fresh candidate
# version per run (epoch patch) so warm re-runs never wedge on prior state, point its
# content at the in-network mock-llm, and drive the full sequence against VKAS (:3040)
# + model-gateway (:3011). The eval-runner resolves the NON-active candidate via VKAS
# :resolve (pinned-version path), runs the kill-switch→PHI→adapter chain through /eval,
# scores the gold set, and posts the eval approval.
VKAS_GATE=${VKAS_GATE:-http://localhost:3040}
MG_GATE=${MG_GATE:-http://localhost:3011}
CAND_URL="https://artifacts.simintero.io/shared/model_binding/claude-pa"
EVAL_SET_URL="https://artifacts.simintero.io/shared/eval_set/claude-pa-gold"
CAND_VER="1.1.$(date +%s)"
echo "   candidate version: $CAND_VER"

# 1. Author the candidate model_binding (content → in-network mock-llm) + submit it.
curl -sf -X POST "$VKAS_GATE/v1/artifacts" \
  -H "x-sim-tenant-id: $TENANT_ID" -H "Content-Type: application/json" \
  -d "{\"canonical_url\":\"$CAND_URL\",\"version\":\"$CAND_VER\",\"artifact_type\":\"model_binding\",\"content\":{\"provider\":\"anthropic\",\"model_id\":\"claude-sonnet-4-6\",\"endpoint_overrides\":{\"pooled\":\"http://mock-llm:3060\"},\"adapter_config\":{\"max_tokens\":1024},\"no_train_enforced\":true}}" \
  >/dev/null || { echo "❌ AI-OPS: author candidate failed" >&2; exit 1; }
curl -sf -X POST "$VKAS_GATE/v1/artifacts/submit" \
  -H "x-sim-tenant-id: $TENANT_ID" -H "Content-Type: application/json" \
  -d "{\"canonical_url\":\"$CAND_URL\",\"version\":\"$CAND_VER\"}" \
  >/dev/null || { echo "❌ AI-OPS: submit candidate failed" >&2; exit 1; }
echo "   authored + submitted $CAND_VER"

# 2. Activate WITHOUT an eval approval → must be 409 (SIM-VKAS-EVAL_REQUIRED).
GATE_409=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$VKAS_GATE/v1/artifacts/activate" \
  -H "x-sim-tenant-id: $TENANT_ID" -H "Content-Type: application/json" \
  -d "{\"canonical_url\":\"$CAND_URL\",\"version\":\"$CAND_VER\"}")
echo "   activate (no eval) → HTTP $GATE_409"
[ "$GATE_409" = "409" ] || { echo "❌ AI-OPS: expected 409 before eval, got $GATE_409" >&2; exit 1; }

# 3. Run the real eval-runner: resolves the candidate via VKAS :resolve, scores the
#    gold set via /eval, posts the gate='eval' approval. Must score 3/3 (exit 0).
pnpm install --filter @sim/eval-scripts >/dev/null 2>&1 || true
EVAL_OUT=$(pnpm --filter @sim/eval-scripts exec tsx eval-runner.ts \
  --binding "$CAND_URL" --binding-version "$CAND_VER" \
  --eval-set "$EVAL_SET_URL" \
  --gateway "$MG_GATE" --vkas "$VKAS_GATE" \
  --approver smoke --tenant "$TENANT_ID" 2>&1) || {
    echo "$EVAL_OUT" >&2; echo "❌ AI-OPS: eval-runner exited non-zero" >&2; exit 1; }
echo "$EVAL_OUT" | sed 's/^/   /'
echo "$EVAL_OUT" | grep -q "3/3 passed" || { echo "❌ AI-OPS: eval-runner did not score 3/3" >&2; exit 1; }

# 4. Activate again now that the eval approval landed → must be 200.
GATE_200=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$VKAS_GATE/v1/artifacts/activate" \
  -H "x-sim-tenant-id: $TENANT_ID" -H "Content-Type: application/json" \
  -d "{\"canonical_url\":\"$CAND_URL\",\"version\":\"$CAND_VER\"}")
echo "   activate (after eval) → HTTP $GATE_200"
[ "$GATE_200" = "200" ] || { echo "❌ AI-OPS: expected 200 after eval, got $GATE_200" >&2; exit 1; }
echo "✅ AI-OPS: model-ops eval gate enforced (409 → eval-runner 3/3 → 200)"

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

echo "── 12. P1-b2a: digicore resolves coverage rules from VKAS (data-driven) ──"
# After P1-b2a, digicore-runtime resolves the governing coverage_rule + its ELM from VKAS
# (seeded by V018) instead of the hardcoded knee branch. We exercise the engine directly:
# (a) knee (27447) still meets_all — now VKAS-resolved, not classpath; (b) a NON-knee
# procedure (72148 lumbar MRI) resolves a VKAS rule + auto-determines data-driven; (c) the
# not_met path proves real evaluation. Request fields are snake_case (SNAKE_CASE jackson).
DIGI="http://localhost:8083"
b2a_eval() {  # $1=service_code  $2=evidence-json  → "<outcome> <eligible>"
  curl -sf -X POST "$DIGI/v1/runtime/evaluate" -H "Content-Type: application/json" \
    -d "{\"case_id\":\"smoke\",\"service_code\":\"$1\",\"pins\":[],\"evidence\":$2}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('outcome'), d.get('auto_determination',{}).get('eligible'))" 2>/dev/null
}
KNEE=$(b2a_eval 27447 '{"diagnosis_documented":true,"conservative_therapy_tried":true,"imaging_documented":true}')
echo "   knee(27447) → ${KNEE}"
[ "$KNEE" = "meets_all True" ] || { echo "❌ b2a: knee not VKAS-resolved to meets_all (got '${KNEE}')" >&2; docker compose logs digicore-runtime 2>&1 | tail -25 >&2; exit 1; }

COV=$(curl -sf -X POST "$DIGI/v1/runtime/coverage-discovery" -H "Content-Type: application/json" \
  -d '{"service_code":"72148","procedure_code":"72148"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('pa_required'))" 2>/dev/null)
echo "   coverage-discovery(72148).pa_required → ${COV}"
[ "$COV" = "True" ] || { echo "❌ b2a: non-knee rule 72148 not resolved from VKAS (pa_required='${COV}')" >&2; docker compose logs digicore-runtime 2>&1 | tail -25 >&2; exit 1; }

MRI=$(b2a_eval 72148 '{"conservative_therapy_6wk":true,"neuro_deficit_or_red_flag":true}')
echo "   lumbar-MRI(72148) → ${MRI}"
[ "$MRI" = "meets_all True" ] || { echo "❌ b2a: non-knee rule 72148 did not evaluate data-driven to meets_all (got '${MRI}')" >&2; docker compose logs digicore-runtime 2>&1 | tail -25 >&2; exit 1; }

MRI2=$(b2a_eval 72148 '{"conservative_therapy_6wk":true,"neuro_deficit_or_red_flag":false}')
echo "   lumbar-MRI(72148) partial-evidence → ${MRI2}"
[ "$MRI2" = "not_met False" ] || { echo "❌ b2a: 72148 not_met path failed (got '${MRI2}')" >&2; exit 1; }
echo "✅ P1-b2a: digicore is data-driven — knee + non-knee rules resolved from VKAS, evaluated correctly"

echo "── 12b. slice 1.1: real CQL-vs-FHIR — digicore retrieves Condition+Procedure from fabric.resource ──"
# Slice 1.1 seeded: member-001/pat-001 has a Condition + Procedure in fabric.resource under tenant-dev;
# coverage rule for 29827 = "exists [Condition] and exists [Procedure]".
# member-003/pat-003 has NO Condition/Procedure seeded → not_met.
fhir_eval() {  # $1=service_code $2=member_ref → "<outcome> <eligible>"
  curl -sf -X POST "$DIGI/v1/runtime/evaluate" -H "Content-Type: application/json" \
    -d "{\"case_id\":\"smoke-fhir\",\"service_code\":\"$1\",\"member_ref\":\"$2\",\"tenant_id\":\"tenant-dev\",\"pins\":[],\"evidence\":{}}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('outcome'), d.get('auto_determination',{}).get('eligible'))" 2>/dev/null
}
FHIR_POS=$(fhir_eval 29827 member-001)
echo "   fhir-retrieve(29827, member-001) → ${FHIR_POS}"
[ "$FHIR_POS" = "meets_all True" ] || { echo "❌ 1.1: FHIR retrieve did not meet_all (got '${FHIR_POS}')" >&2; docker compose logs digicore-runtime 2>&1 | tail -30 >&2; exit 1; }
FHIR_NEG=$(fhir_eval 29827 member-003)   # pat-003 has no Condition/Procedure seeded
echo "   fhir-retrieve(29827, member-003) → ${FHIR_NEG}"
[ "$FHIR_NEG" = "not_met False" ] || { echo "❌ 1.1: FHIR retrieve negative case wrong (got '${FHIR_NEG}')" >&2; exit 1; }
echo "✅ slice 1.1: real CQL-vs-FHIR — Condition+Procedure retrieved from fabric.resource, evaluated correctly"

echo "── 12c. slice 1.2: value-set MEMBERSHIP filtering ──"
# Slice 1.2 seeded: member-001 has a Condition with SNOMED 239873007 (IN the Knee VS) → meets_all;
# member-002 has a Condition with SNOMED 73211009 (NOT in the Knee VS) → filtered out → not_met.
# This proves filtering, not bare exists: the non-member code is excluded by value-set expansion.
VS_POS=$(fhir_eval 29828 member-001)
echo "   value-set(29828, member-001) → ${VS_POS}"
[ "$VS_POS" = "meets_all True" ] || { echo "❌ 1.2: value-set match did not meet_all (got '${VS_POS}')" >&2; docker compose logs digicore-runtime 2>&1 | tail -30 >&2; exit 1; }
VS_NEG=$(fhir_eval 29828 member-002)
echo "   value-set(29828, member-002) → ${VS_NEG}"
[ "$VS_NEG" = "not_met False" ] || { echo "❌ 1.2: non-member code was NOT filtered out (got '${VS_NEG}') — value-set filtering regressed" >&2; exit 1; }
echo "✅ slice 1.2: value-set MEMBERSHIP filtering — member-001 (SNOMED 239873007) meets_all, member-002 (73211009 not in VS) not_met"

echo "── 12d. slice 2.1: intake→fabric bridge — real \$submit writes evidence → meets_all ──"
# Slice 2.1: on PAS \$submit the workflow-engine normalize handler synchronously bridges the
# bundle's clinical evidence into fabric.resource (under case.tenant_id = TENANT_ID, keyed by
# the bare Patient logical id member_ref) BEFORE auto_determination. We \$submit the richer PAS
# fixture (Patient pat-smoke, Claim CPT 29828, Claim.diagnosis ICD-10 M17.0 ∈ the seeded Knee VS),
# then assert (a) the bridge wrote a derived Condition(M17.0) for pat-smoke, and (b) the engine
# retrieves that bridged evidence → meets_all for 29828/pat-smoke. The evaluate MUST use the SAME
# tenant the \$submit ran under (TENANT_ID) or RLS hides the row.
# Give the bundle a unique id per run so interop's per-correlation_id dedup never blocks a
# warm re-run (the fabric upsert is idempotent on member_ref/fhir_id regardless). Patient id,
# CPT 29828 and ICD-10 M17.0 are kept exactly so the bridge keys on pat-smoke under TENANT_ID.
S21_CORR="pas-bundle-smoke-$(date +%s)"
SMOKE21_BUNDLE=$(S21_CORR="$S21_CORR" python3 -c "import json,os; b=json.load(open('services/enstellar-workflow/tests/fixtures/pas_bundle_with_diagnosis.json')); b['id']=os.environ['S21_CORR']; print(json.dumps(b))")
S21_RESP=$(curl -s -X POST "$INTEROP/fhir/Claim/\$submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -H "Accept: application/fhir+json" \
  --data-binary "$SMOKE21_BUNDLE")
echo "$S21_RESP" | python3 -c "
import sys, json
b = json.load(sys.stdin)
assert b.get('resourceType') == 'Bundle', f'expected Bundle, got {b}'
cr = b.get('entry', [{}])[0].get('resource', {})
assert cr.get('resourceType') == 'ClaimResponse', f'expected ClaimResponse, got {cr}'
print('   2.1 \$submit OK — ClaimResponse outcome=' + cr.get('outcome', '?'))
" || { echo \"❌ 2.1: \\\$submit did not return a ClaimResponse: \$S21_RESP\" >&2; exit 1; }
# (a) the bridge wrote the derived Condition(M17.0) for pat-smoke (poll: the write is synchronous
# in normalize, but \$submit's normalize call is in-band so the row exists by the time we return).
S21_COND=""
for i in $(seq 1 15); do
  S21_COND=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
    "select content->'code'->'coding'->0->>'code' from fabric.resource where member_ref='pat-smoke' and resource_type='Condition' and tenant_id='${TENANT_ID}' limit 1;" \
    2>/dev/null | tr -d '[:space:]')
  echo "   poll $i: fabric Condition code='${S21_COND}'"
  [ "$S21_COND" = "M17.0" ] && break
  sleep 1
done
if [ "$S21_COND" != "M17.0" ]; then
  echo "❌ 2.1: bridge did not write Condition(M17.0) for pat-smoke under tenant=${TENANT_ID}" >&2
  echo "   --- fabric rows for pat-smoke (any tenant, superuser bypasses RLS) ---" >&2
  docker compose exec -T postgres psql -U sim -d simintero -c \
    "select tenant_id, resource_type, fhir_id, member_ref from fabric.resource where member_ref='pat-smoke';" >&2
  echo "   --- workflow-engine logs (look for 'fabric bridge wrote N evidence rows') ---" >&2
  docker compose logs workflow-engine 2>&1 | tail -60 >&2
  exit 1
fi
echo "   fabric Condition row:"
docker compose exec -T postgres psql -U sim -d simintero -c \
  "select resource_type, fhir_id, member_ref, content->'code'->'coding'->0->>'code' as code from fabric.resource where member_ref='pat-smoke' and resource_type='Condition' and tenant_id='${TENANT_ID}';"
# (b) the engine retrieves the bridged evidence → meets_all for 29828/pat-smoke (SAME tenant).
S21_EVAL=$(curl -sf -X POST "$DIGI/v1/runtime/evaluate" -H "Content-Type: application/json" \
  -d "{\"case_id\":\"smoke-2.1\",\"service_code\":\"29828\",\"member_ref\":\"pat-smoke\",\"tenant_id\":\"${TENANT_ID}\",\"pins\":[],\"evidence\":{}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('outcome'), d.get('auto_determination',{}).get('eligible'))" 2>/dev/null)
echo "   bridged-evidence(29828, pat-smoke, tenant=${TENANT_ID}) → ${S21_EVAL}"
[ "$S21_EVAL" = "meets_all True" ] || { echo "❌ 2.1: bridged evidence did not evaluate to meets_all (got '${S21_EVAL}') — tenant mismatch or code not in Knee VS?" >&2; docker compose logs digicore-runtime 2>&1 | tail -30 >&2; exit 1; }
echo "✅ slice 2.1: real \$submit → fabric evidence bridge (Condition M17.0 for pat-smoke under ${TENANT_ID}) → engine meets_all"

echo "── 13. P1-b2b: author a rule through the full governance lifecycle ──"
# Author a BRAND-NEW procedure (CPT 29826 shoulder arthroscopy, NOT in the V018 seed) end to
# end via the live authoring (:3052) + governance (:3053) services, then prove digicore (:8083)
# resolves + evaluates the authored rule. Proves author→approve(clinical+compliance,SOD)→activate→
# digicore-resolves, distinct from the seeded rules.
python3 - <<'PYEOF'
import json, subprocess, sys, time, urllib.request
AUTH="http://localhost:3052"; GOV="http://localhost:3053"; DIGI="http://localhost:8083"
def post(url, body):
    req=urllib.request.Request(url, data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.load(r)
def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.status, json.load(r)
def fail(msg):
    print("❌ b2b:", msg, file=sys.stderr); sys.exit(1)

CQL = ("library ShoulderArthroscopy version '1.0.0'\n"
       'parameter "imaging_confirms_pathology" Boolean\n'
       'parameter "failed_conservative_therapy" Boolean\n'
       'define "Imaging Confirms Pathology": "imaging_confirms_pathology"\n'
       'define "Failed Conservative Therapy": "failed_conservative_therapy"\n'
       'define "Meets All Criteria":\n'
       '  "Imaging Confirms Pathology" and "Failed Conservative Therapy"')

# 1. author → compile → drafts(cql_library+coverage_rule) → submit both → enqueue
try:
    st, rule = post(f"{AUTH}/v1/authoring/rules", {
        "procedure_code":"29826","slug":"shoulder-arthroscopy","cql":CQL,
        "pa_required":True,"pins":["urn:sim:policy:shoulder-arthroscopy:1.0.0"],
        "dtr_package_ref":"urn:sim:dtr:shoulder-arthroscopy:1.0.0",
        "evidence_requirements":[
            {"requirement_id":"imaging_confirms_pathology","display":"Imaging confirms pathology","required":True},
            {"requirement_id":"failed_conservative_therapy","display":"Failed conservative therapy","required":True}],
        "created_by":"author-x"})
except Exception as e:
    fail(f"authoring /rules failed: {e}")
rid = rule.get("rule_id")
print(f"   authored rule_id={rid} status={rule.get('status')}")
if not rid: fail("authoring /rules returned no rule_id")

# 2. governance approvals (SOD: approvers != author-x), 2 distinct gates.
#    The clinical approval is recorded FIRST, then digicore-governance is restarted
#    BETWEEN the two gates to prove the approval persisted to the durable (Postgres)
#    store. If the store were in-memory the restart would drop the clinical approval
#    and the later activate would 409 "both gates must be approved"; a green activate
#    after the restart proves durability.
try:
    st,_ = post(f"{GOV}/v1/governance/approve",
        {"artifact_id":rid,"gate":"clinical","decision":"approved","approver":"reviewer-a"})
except Exception as e:
    fail(f"clinical approval failed: {e}")
print("   approved gate=clinical by reviewer-a")

print("   [P0-0.3] restarting digicore-governance to prove approval durability ...")
subprocess.run(["docker","compose","restart","digicore-governance"],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(["docker","compose","up","-d","--wait","digicore-governance"],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# poll the restarted service until the queue endpoint is serving again
q=None
for _ in range(30):
    try:
        _, q = get(f"{GOV}/v1/governance/queue"); break
    except Exception:
        time.sleep(1)
if q is None: fail("governance queue unreachable after restart")
m=[a for a in q["artifacts"] if a["artifact_id"]==rid]
if not (m and any(p["gate"]=="clinical" and p["decision"]=="approved" for p in m[0]["approvals"])):
    fail("clinical approval lost on restart — governance store is NOT durable")
print("   [P0-0.3] clinical approval survived restart — governance store is durable")

try:
    st,_ = post(f"{GOV}/v1/governance/approve",
        {"artifact_id":rid,"gate":"compliance","decision":"approved","approver":"reviewer-b"})
except Exception as e:
    fail(f"compliance approval failed: {e}")
print("   approved gate=compliance by reviewer-b")

# 3. activate (both gates ready → both artifacts → active)
try:
    st, act = post(f"{GOV}/v1/governance/activate", {"artifact_id":rid})
except Exception as e:
    fail(f"activate failed: {e}")
print(f"   activated: {act}")

# 4. digicore resolves + evaluates the AUTHORED rule
time.sleep(2)
try:
    st, cov = post(f"{DIGI}/v1/runtime/coverage-discovery", {"service_code":"29826","procedure_code":"29826"})
except Exception as e:
    fail(f"coverage-discovery failed: {e}")
print(f"   coverage-discovery(29826).pa_required={cov.get('pa_required')}")
if cov.get("pa_required") is not True: fail(f"authored rule 29826 not resolvable (pa_required={cov.get('pa_required')})")
try:
    st, ev = post(f"{DIGI}/v1/runtime/evaluate", {"case_id":"s","service_code":"29826","pins":[],
        "evidence":{"imaging_confirms_pathology":True,"failed_conservative_therapy":True}})
except Exception as e:
    fail(f"evaluate failed: {e}")
outcome=ev.get("outcome"); eligible=ev.get("auto_determination",{}).get("eligible")
print(f"   evaluate(29826) outcome={outcome} eligible={eligible}")
if not (outcome=="meets_all" and eligible is True):
    fail(f"authored rule 29826 did not evaluate to meets_all/eligible (got {outcome}/{eligible})")
print("✅ P1-b2b: rule authored → approved (clinical+compliance) → activated → digicore resolves + evaluates it")
PYEOF
if [ $? -ne 0 ]; then
  echo "   --- digicore-authoring logs ---" >&2; docker compose logs digicore-authoring 2>&1 | tail -20 >&2
  echo "   --- digicore-governance logs ---" >&2; docker compose logs digicore-governance 2>&1 | tail -20 >&2
  echo "   --- vkas logs ---" >&2; docker compose logs vkas 2>&1 | tail -15 >&2
  exit 1
fi

echo "── 13b. slice 1.3: VKAS rollback round-trip + persisted rules trace ──"
# (a) Rollback round-trip. Seed a self-contained coverage_rule with v1.0.0 active +
#     v1.0.1 approved (tenant 'shared' so RLS reads/writes succeed under any tenant GUC),
#     then ACTIVATE v1.0.1 via the real route (demotes v1.0.0 -> superseded), then ROLLBACK
#     v1.0.1 via the path-based route. Assert HTTP 200 + restored 1.0.0 active + 1.0.1
#     rolled_back. Proves the rollback route end-to-end against the live DB (V028 CHECK).
VKAS_URL=${VKAS_URL:-http://localhost:3040}
RB_URL="https://artifacts.simintero.io/shared/coverage_rule/smoke-rollback-1.3"
RB_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$RB_URL")
# Clean any prior smoke run's rows, then seed v1.0.0 active + v1.0.1 approved (superuser bypasses RLS).
docker compose exec -T postgres psql -U sim -d simintero -q -c \
  "DELETE FROM vkas.artifact WHERE canonical_url='${RB_URL}';
   INSERT INTO vkas.artifact (canonical_url,version,tenant_id,artifact_type,status,effective_from,content,content_hash,created_by) VALUES
     ('${RB_URL}','1.0.0','shared','coverage_rule','active',CURRENT_DATE,jsonb_build_object('pa_required',true,'rev',1),'sha256:rb-100','smoke-1.3'),
     ('${RB_URL}','1.0.1','shared','coverage_rule','approved',NULL,jsonb_build_object('pa_required',true,'rev',2),'sha256:rb-101','smoke-1.3');" \
  >/dev/null || { echo "❌ 1.3: failed to seed rollback fixtures" >&2; exit 1; }
# Activate v1.0.1 via the real route → demotes v1.0.0 to superseded.
ACT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$VKAS_URL/v1/artifacts/activate" \
  -H "Content-Type: application/json" -H "x-sim-tenant-id: ${TENANT_ID}" \
  -d "{\"canonical_url\":\"${RB_URL}\",\"version\":\"1.0.1\"}")
[ "$ACT_CODE" = "200" ] || { echo "❌ 1.3: activate v1.0.1 returned ${ACT_CODE} (expected 200)" >&2; docker compose logs vkas 2>&1 | tail -25 >&2; exit 1; }
# Rollback v1.0.1 via the path-based route (canonical_url percent-encoded).
RB_RESP=$(curl -sS -w $'\n%{http_code}' -X POST "$VKAS_URL/v1/artifacts/${RB_ENC}/1.0.1/rollback" \
  -H "Content-Type: application/json" -H "x-sim-tenant-id: ${TENANT_ID}" \
  -d '{"reason":"smoke"}')
RB_CODE=$(echo "$RB_RESP" | tail -n1)
RB_BODY=$(echo "$RB_RESP" | sed '$d')
echo "   rollback HTTP ${RB_CODE}; body=${RB_BODY}"
[ "$RB_CODE" = "200" ] || { echo "❌ 1.3: rollback returned ${RB_CODE} (expected 200)" >&2; docker compose logs vkas 2>&1 | tail -25 >&2; exit 1; }
echo "$RB_BODY" | python3 -c "
import sys,json
r=json.load(sys.stdin)
restored=r.get('restored',{}); rolled=r.get('rolled_back',{})
assert restored.get('version')=='1.0.0', f\"restored.version={restored.get('version')} (expected 1.0.0)\"
assert restored.get('status')=='active', f\"restored.status={restored.get('status')} (expected active)\"
assert rolled.get('status')=='rolled_back', f\"rolled_back.status={rolled.get('status')} (expected rolled_back)\"
print(f\"   rollback round-trip OK: restored {restored.get('version')}/{restored.get('status')}, target {rolled.get('version')}/{rolled.get('status')}\")
" || { echo "❌ 1.3: rollback response did not restore 1.0.0 active / target rolled_back" >&2; exit 1; }
echo "✅ slice 1.3a: VKAS rollback round-trip — activate v1.0.1 (demote v1.0.0→superseded) → rollback (restore 1.0.0 active, v1.0.1 rolled_back), HTTP 200"

# (b) Persisted trace. The slice 1.1/1.2 evaluate calls (fhir_eval → :8083/v1/runtime/evaluate
#     with tenant_id=tenant-dev) now persist a sim.case.trace / TraceCreated/v1 row to shared.outbox.
TRACE_CT=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
  "select count(*) from shared.outbox where topic='sim.case.trace';" 2>/dev/null | tr -d '[:space:]')
echo "   shared.outbox(topic=sim.case.trace) count=${TRACE_CT}"
[ "${TRACE_CT:-0}" -ge 1 ] || { echo "❌ 1.3: no persisted sim.case.trace outbox row (count=${TRACE_CT}) — digicore did not persist the rules trace" >&2; docker compose logs digicore-runtime 2>&1 | tail -25 >&2; exit 1; }
echo "✅ slice 1.3b: persisted rules trace — digicore evaluate(tenant_id) wrote ${TRACE_CT} sim.case.trace row(s) to shared.outbox"

echo "── 14. P1-a: Qualitron runs a quality measure end-to-end ──"
# POST a measure run (the seeded hedis:BCS-E over the seeded FHIR data: 4 Patients, 2 with the
# numerator Observation). The run executes in-service (background, tenant-GUC'd): fetch eligible
# members → evaluate over fabric.resource → persist measure_report → detect+persist gaps. We poll
# the run to 'complete' then assert the data-driven result directly in the DB (the reporting read
# API is a separate not-yet-deployed module): denominator=4, numerator=2, gaps=2.
QUAL="http://localhost:3015"; QTID="${TENANT_ID:-tenant-dev}"
QRUN=$(curl -sf -X POST "$QUAL/v1/quality/runs" -H "Content-Type: application/json" -H "x-sim-tenant-id: $QTID" \
  -d '{"measure_ref":"hedis:BCS-E","measure_version":"1.0.0","period_start":"2026-01-01","period_end":"2026-06-30"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('run_id',''))" 2>/dev/null)
echo "   run_id=${QRUN}"
[ -n "$QRUN" ] || { echo "❌ P1-a: POST /quality/runs did not return a run_id" >&2; docker compose logs qualitron 2>&1 | tail -20 >&2; exit 1; }
QSTATUS=""
for i in $(seq 1 30); do
  QSTATUS=$(curl -sf "$QUAL/v1/quality/runs/$QRUN" -H "x-sim-tenant-id: $QTID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo '')
  echo "   poll $i: run status='${QSTATUS}'"
  [ "$QSTATUS" = "complete" ] && break
  [ "$QSTATUS" = "failed" ] && { echo "❌ P1-a: run failed" >&2; docker compose logs qualitron 2>&1 | tail -25 >&2; exit 1; }
  sleep 2
done
[ "$QSTATUS" = "complete" ] || { echo "❌ P1-a: run did not complete (status='${QSTATUS}')" >&2; docker compose logs qualitron 2>&1 | tail -25 >&2; exit 1; }
# Assert the run's data-driven result directly in the DB (superuser bypasses RLS; explicit WHERE run_id).
QRES=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
  "SELECT count(*) FILTER (WHERE denominator), count(*) FILTER (WHERE numerator) FROM qual.measure_report WHERE run_id='${QRUN}';" 2>/dev/null | tr -d ' ')
QGAPS=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
  "SELECT count(*) FROM qual.gap WHERE measure_ref='hedis:BCS-E' AND status='open' AND member_id IN (SELECT member_id FROM qual.measure_report WHERE run_id='${QRUN}');" 2>/dev/null | tr -d '[:space:]')
echo "   measure_report (denominator|numerator)=${QRES} ; open gaps=${QGAPS}"
echo "$QRES" | python3 -c "
import sys; den,num = sys.stdin.read().strip().split('|')
den=int(den); num=int(num)
assert den>=4, f'denominator {den} < 4'
assert num>=2, f'numerator {num} < 2'
assert num < den, f'numerator {num} should be < denominator {den} (some gaps expected)'
print(f'  denominator={den} numerator={num} rate={num/den:.2f}')
" || { echo "❌ P1-a: measure_report did not show the expected data-driven result (got '${QRES}')" >&2; docker compose logs qualitron 2>&1 | tail -25 >&2; exit 1; }
[ "${QGAPS:-0}" -ge 2 ] || { echo "❌ P1-a: expected >=2 open gaps, got '${QGAPS}'" >&2; exit 1; }
echo "✅ P1-a: Qualitron computed a quality measure end-to-end (4 reports, numerator=2, ${QGAPS} gaps) over seeded FHIR data"

echo "── 14b. P1-c: quality gaps produced Task-service tasks (gap→task→worklist→resolve) ──"
# With TASK_SERVICE_URL now live, the Qualitron run's OutreachTaskCreator (sending x-sim-tenant-id)
# created a quality-outreach task per gap in the Task service + linked it via qual.outreach_task_ref.
# Assert the rows exist (no longer lenient), then exercise the Task API: worklist → assign → resolve.
TASKSVC="http://localhost:3021"
OTR=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
  "SELECT count(*) FROM qual.outreach_task_ref;" 2>/dev/null | tr -d '[:space:]')
TT=$(docker compose exec -T postgres psql -U sim -d simintero -tAc \
  "SELECT count(*) FROM task.task WHERE task_kind='quality-outreach';" 2>/dev/null | tr -d '[:space:]')
echo "   outreach_task_ref=${OTR} ; task.task(quality-outreach)=${TT}"
{ [ "${OTR:-0}" -ge 1 ] && [ "${TT:-0}" -ge 1 ]; } || { echo "❌ P1-c: gap did not create a task (outreach_task_ref=${OTR}, task.task=${TT})" >&2; docker compose logs task-service 2>&1 | tail -20 >&2; docker compose logs qualitron 2>&1 | tail -20 >&2; exit 1; }
# Task worklist API: list → assign → resolve a quality-outreach task
TASKID=$(curl -sf "$TASKSVC/v1/tasks?task_kind=quality-outreach&status=open" -H "x-sim-tenant-id: tenant-dev" \
  | python3 -c "import sys,json; t=json.load(sys.stdin)['tasks']; print(t[0]['task_id'] if t else '')" 2>/dev/null)
echo "   worklist open task_id=${TASKID}"
[ -n "$TASKID" ] || { echo "❌ P1-c: worklist returned no open quality-outreach task" >&2; docker compose logs task-service 2>&1 | tail -15 >&2; exit 1; }
curl -sf -X PATCH "$TASKSVC/v1/tasks/$TASKID" -H "Content-Type: application/json" -H "x-sim-tenant-id: tenant-dev" \
  -d '{"assignee":"reviewer-a","assignee_queue":"quality"}' -o /dev/null \
  || { echo "❌ P1-c: assign failed" >&2; exit 1; }
RSTATUS=$(curl -sf -X PATCH "$TASKSVC/v1/tasks/$TASKID" -H "Content-Type: application/json" -H "x-sim-tenant-id: tenant-dev" \
  -d '{"status":"resolved"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
echo "   resolved status=${RSTATUS}"
[ "$RSTATUS" = "resolved" ] || { echo "❌ P1-c: resolve did not set status=resolved (got '${RSTATUS}')" >&2; exit 1; }
echo "✅ P1-c: quality gap → Task-service task → worklist (assign) → resolved"

echo "── 15. P1-d: terminology service validates codes against seeded value-sets ──"
TS_BASE="http://localhost:3030"
KNEE_VS="http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498"
BOGUS_VS="http://example.org/fhir/ValueSet/does-not-exist"

# (a) direct gateway asserts
SEEDED_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${TS_BASE}/fhir/ValueSet/\$validate-code?url=${KNEE_VS}")
BOGUS_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${TS_BASE}/fhir/ValueSet/\$validate-code?url=${BOGUS_VS}")
echo "   validate-code seeded=${SEEDED_CODE} ; bogus=${BOGUS_CODE}"
{ [ "$SEEDED_CODE" = "200" ] && [ "$BOGUS_CODE" = "404" ]; } || { echo "❌ P1-d: validate-code resolvability wrong (seeded=${SEEDED_CODE} bogus=${BOGUS_CODE})" >&2; docker compose logs terminology-service 2>&1 | tail -20 >&2; exit 1; }

MEMBER=$(curl -sS "${TS_BASE}/fhir/ValueSet/\$validate-code?url=${KNEE_VS}&system=http://snomed.info/sct&code=239873007" | python3 -c "import sys,json; ps=json.load(sys.stdin)['parameter']; print(next(p['valueBoolean'] for p in ps if p['name']=='result'))")
NONMEMBER=$(curl -sS "${TS_BASE}/fhir/ValueSet/\$validate-code?url=${KNEE_VS}&system=http://snomed.info/sct&code=000000" | python3 -c "import sys,json; ps=json.load(sys.stdin)['parameter']; print(next(p['valueBoolean'] for p in ps if p['name']=='result'))")
echo "   member(239873007)=${MEMBER} ; non-member(000000)=${NONMEMBER}"
{ [ "$MEMBER" = "True" ] && [ "$NONMEMBER" = "False" ]; } || { echo "❌ P1-d: code membership wrong (member=${MEMBER} non-member=${NONMEMBER})" >&2; exit 1; }

CONCEPTS=$(curl -sS "${TS_BASE}/fhir/ValueSet/\$expand?url=${KNEE_VS}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['expansion']['contains']))")
echo "   expand concepts=${CONCEPTS}"
[ "${CONCEPTS:-0}" -ge 1 ] || { echo "❌ P1-d: \$expand returned no concepts" >&2; exit 1; }

# (b) end-to-end: digicore-authoring validate drives the live terminology service
VALIDATE_RESP=$(curl -sS -X POST "http://localhost:3052/v1/authoring/validate" \
  -H 'content-type: application/json' \
  -d '{"cql":"library SmokeTerminology version '"'"'1.0.0'"'"'\nvalueset \"Knee Conditions\": '"'"'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498'"'"'\nvalueset \"Bogus Unseeded\": '"'"'http://example.org/fhir/ValueSet/does-not-exist'"'"'\n"}')
echo "   authoring validate → ${VALIDATE_RESP}"
echo "$VALIDATE_RESP" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert r['valid'] is False, f'expected valid:false, got {r}'
assert r['unresolvedValueSets'] == ['http://example.org/fhir/ValueSet/does-not-exist'], f'unexpected unresolved set: {r}'
print('   authoring resolved the seeded value-set and flagged only the bogus one')
"
echo "✅ P1-d: terminology service live — code membership + \$expand + authoring \$validate-code wiring"
echo "── 16. P0-0.2: relay ships substrate events to the broker ──"
RELAY_TASK=$(curl -sS -XPOST localhost:3021/v1/tasks -H 'content-type: application/json' -H 'x-sim-tenant-id: tenant-dev' \
  -d '{"task_kind":"relay-smoke","payload":{"probe":true}}')
echo "   created task: ${RELAY_TASK}"
PUB=0
for i in $(seq 1 10); do
  PUB=$(docker compose exec -T postgres psql -U sim -d simintero -tAc "SELECT count(*) FROM shared.outbox WHERE topic='sim.task.lifecycle' AND published_at IS NOT NULL;")
  [ "${PUB:-0}" -ge 1 ] && break; sleep 1
done
echo "   sim.task.lifecycle rows published_at set: ${PUB}"
{ [ "${PUB:-0}" -ge 1 ]; } || { echo "❌ P0-0.2: relay did not drain sim.task.lifecycle" >&2; docker compose logs relay 2>&1 | tail -30 >&2; exit 1; }
BROKER_MSG=$(docker compose exec -T redpanda rpk topic consume sim.task.lifecycle --num 1 --offset oldest --format '%v\n' 2>/dev/null | head -1)
echo "   broker envelope: ${BROKER_MSG}"
echo "$BROKER_MSG" | python3 -c "import sys,json; e=json.load(sys.stdin); assert e['schema_ref'].startswith('sim.task.lifecycle/'), e; print('   broker carries a sim.task.lifecycle envelope')"
echo "✅ P0-0.2: substrate event flowed producer → simintero.shared.outbox → relay → redpanda"
echo "✅ unified-stack smoke PASSED"
