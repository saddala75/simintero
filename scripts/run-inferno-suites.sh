#!/usr/bin/env bash
# Run all five Inferno conformance suites and report results.
# Exit code = number of failing suites (0 = all pass/skip, >=1 = failures).
# Requires: curl, jq
set -euo pipefail

FHIR_URL="${FHIR_URL:-http://localhost:8080/fhir}"
TOKEN="${INFERNO_CONFORMANCE_TOKEN:-conformance-test-token}"
FAILURES=0

run_suite() {
  local NAME="$1" BASE_URL="$2" SUITE_ID="$3"

  echo "==> [$NAME] creating session (suite=$SUITE_ID) ..."
  local SESSION_ID
  SESSION_ID=$(curl -sf -X POST "$BASE_URL/api/test_sessions" \
    -H "Content-Type: application/json" \
    -d "{\"test_suite_id\":\"$SUITE_ID\",\"inputs\":[{\"name\":\"url\",\"value\":\"$FHIR_URL\"},{\"name\":\"additional_headers\",\"value\":\"Authorization: Bearer $TOKEN\"}]}" \
    | jq -r '.id')

  if [[ -z "$SESSION_ID" || "$SESSION_ID" == "null" ]]; then
    echo "  ERROR: [$NAME] failed to create session — suite marked failed"
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "    session_id=$SESSION_ID"

  curl -sf -X POST "$BASE_URL/api/test_sessions/$SESSION_ID/run" > /dev/null
  echo "    run started"

  local RESULT="running" i=0
  while [[ "$RESULT" == "running" && $i -lt 60 ]]; do
    sleep 5
    i=$((i + 1))
    # ponytail: || true prevents set -e from aborting on transient network hiccups
    RESULT=$(curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID" 2>/dev/null \
      | jq -r '.result // "running"' 2>/dev/null || echo "running")
  done

  echo "    result=$RESULT"
  if [[ "$RESULT" != "pass" ]]; then
    echo "  --- FAILURES ---"
    curl -sf "$BASE_URL/api/test_sessions/$SESSION_ID/results" \
      | jq -r '.[] | select(.result == "fail") | "  FAIL: \(.title)"' 2>/dev/null || true
    FAILURES=$((FAILURES + 1))
  fi
}

# Suite IDs must match GET /api/test_suites on each kit (verified in Task 2 Step 5).
run_suite "us-core" "http://localhost:4545" "us_core_v501"
run_suite "smart"   "http://localhost:4546" "smart_app_launch"
run_suite "pas"     "http://localhost:4547" "davinci_pas_v201"
run_suite "crd"     "http://localhost:4548" "davinci_crd"
run_suite "dtr"     "http://localhost:4549" "davinci_dtr"

echo ""
echo "$FAILURES suite(s) failed."
exit $FAILURES
