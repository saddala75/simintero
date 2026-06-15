# ICD C-2 — Revital Advisory Output Contract

| | |
|---|---|
| **Contract ID** | C-2 (`contracts/openapi/c2-revital-advisory.yaml`) |
| **Provider** | Revital pipeline service `[REV]` |
| **Consumers** | Enstellar (reviewer workspace, workflow orchestration), Appeals, Audit/evidence exporter |
| **Version** | 1.0.0-draft · semver |
| **Status** | For ratification — blocks Phase 2 build; schema shapes block Phase 1 workspace UI |
| **PRD trace** | ENS-AI-1..4, ENS-ATT-2, REV §7.1, §8 (extraction/summarization/triage/feedback), REV §19 release criteria |

---

## 1. Purpose & scope

Defines how Enstellar requests AI analysis of a case's documents and receives **advisory** outputs: a cited summary, extracted structured evidence, completeness/conflict assessment against Digicore requirements, and a triage suggestion — plus how reviewer actions flow back. The contract encodes the governance invariants (advisory typing, citation enforcement, abstention, disablement) as schema, so they cannot be "forgotten" by either side.

Out of scope: model/prompt lifecycle (VKAS + Model Gateway), document storage (platform Document contract), evaluation pipelines.

## 2. Conventions

Same transport/auth/tenant-context/idempotency/error conventions as C-1 §2 (`SIM-REV-*` codes). All inference performed by the provider goes through the platform Model Gateway; this contract's consumers never see provider/model endpoints.

## 3. Governance invariants (normative)

- **INV-1 Advisory-only typing.** Every output object carries `"classification": "advisory"`. No field in this contract is accepted by any decision-recording endpoint; Enstellar's `decision.record` command schema has no slot for a C-2 object. AI output can therefore *inform* but never *constitute* a determination (ENS-AI-3, REV non-goal #1).
- **INV-2 Citation enforcement.** Every `summary.assertions[]` item MUST have ≥1 `citations[]` entry resolving to a document span. The schema makes `citations` `minItems: 1`; the provider drops or regenerates uncited assertions and, failing that, abstains for that section. Consumers MUST render citations alongside assertions.
- **INV-3 Abstention is a result, not an error.** Below grounding/confidence thresholds the provider returns `abstained` blocks with reasons — HTTP 200. Consumers MUST render abstention as "needs human review," never as empty/neutral content.
- **INV-4 Versions on everything.** `interaction.model_binding@version` and `interaction.prompt@version` are required on every analysis and every per-block record (ENS-AI-2).
- **INV-5 Disablement degrades gracefully.** If AI is disabled for the tenant/workflow (entitlement), provider returns `409 SIM-REV-DISABLED`; Enstellar hides AI surfaces and the workflow proceeds unchanged (ENS-AI-3 AC).
- **INV-6 Boundary integrity.** Inference resolves only to the caller's deployment boundary (gateway-enforced); the contract exposes no way to select endpoints (ENS-AI-4).

## 4. Operations

### 4.1 `POST /v1/assist/analyses` — request case analysis (async)

```yaml
request:
  case_ref: string
  analysis_kinds: [summary, extraction, completeness, triage]   # subset allowed
  inputs:
    document_refs: [string]                  # platform Document refs
    questionnaire_responses: [string]
    case_context: { lob, urgency, service_lines: [{line_id, code, system}] }
  evidence_requirements:                     # from C-1 §4.4; pass-through with its pins
    requirements_ref: { trace_ref, pins }
  priority: interactive | batch
response 202:
  analysis_id: string
  operation: /v1/operations/{id}
```

Provider executes as a durable workflow; progress events on `sim.ai.interaction`; completion signaled to Enstellar (Temporal signal) and via operation status. **Latency targets:** interactive — first partial (summary skeleton) ≤ 20s p90, complete ≤ 90s p90 for ≤ 200-page packets; batch best-effort.

### 4.2 `GET /v1/assist/analyses/{analysis_id}` — the Advisory Result (normative shape)

```json
{
  "analysis_id": "ana_01J…",
  "classification": "advisory",
  "status": "complete | partial | failed",
  "case_ref": "case_01J…",
  "interaction": {
    "model_binding": { "canonical_url": "…/model_binding/pa-review", "version": "2.3.0" },
    "prompt": { "canonical_url": "…/prompt/pa-summary", "version": "1.4.0" },
    "started_at": "…", "completed_at": "…",
    "input_manifest": [ {"kind":"document","ref":"doc_77","hash":"sha256:…"} ]
  },
  "summary": {
    "status": "ok | abstained",
    "abstain_reason": null,
    "assertions": [
      { "id": "a1",
        "text": "Member completed 8 weeks of physical therapy ending 2026-04-12.",
        "citations": [ { "document_ref": "doc_77", "page": 4, "region": [112,40,480,88],
                          "excerpt_hash": "sha256:…", "trace_ref": "trc_…" } ],
        "confidence": 0.91 }
    ]
  },
  "extraction": {
    "status": "ok | abstained",
    "resources": [
      { "fabric_ref": "fabric/Procedure/px_551",
        "resource_type": "Procedure",
        "provenance_ref": "trc_…",            
        "normalization": { "system": "CPT", "code": "97110", "raw_text": "ther ex" },
        "confidence": 0.88 }
    ]
  },
  "completeness": {
    "status": "ok | abstained",
    "against": { "requirements_trace_ref": "trc_…", "pins": [ … ] },
    "satisfied": [ { "requirement_id": "req-pt-trial", "evidence_refs": ["fabric/Procedure/px_551"] } ],
    "gaps":      [ { "requirement_id": "req-imaging", "description": "MRI report not found",
                     "search_attempted": true } ],
    "conflicts": [ { "description": "Op note date precedes referral date",
                     "refs": ["doc_77#p2", "doc_81#p1"] } ]
  },
  "triage": {
    "status": "ok | abstained",
    "suggestion": "likely_meets | needs_rfi | route_to_clinician",
    "confidence": 0.84,
    "calibration_ref": "evalset:pa-triage@2026Q2",
    "rationale_assertion_ids": ["a1","a3"]
  },
  "abstentions": [ { "block": "triage", "reason": "confidence 0.41 < threshold 0.60" } ],
  "unprocessed_inputs": [ { "ref": "doc_90", "reason": "unsupported format; routed to manual" } ]
}
```

Field rules: extracted `resources` are already persisted to the fabric **with Provenance** (Trace profile `ai_citation`) before the result returns, so Digicore evaluate can use them by ref; `triage.suggestion` enum is closed (no free text); `confidence` values are calibrated against the referenced eval set, and the provider MUST NOT emit confidences for blocks lacking calibration data.

### 4.3 `POST /v1/assist/analyses/{id}/feedback` — reviewer action capture

```yaml
request:
  actor: from x-sim-ctx (human principal required)
  items:
    - target: assertion:a1 | extraction:px_551 | completeness:req-imaging | triage
      action: accepted | edited | overridden | flagged
      reason_code: incorrect | incomplete | irrelevant | hallucination_suspected | other
      note: string (no PHI policy applies)
      replacement: object | null          # for 'edited' — typed per target kind
response 204
```

Feedback joins the interaction record (audit) and the evaluation loop (override-rate monitoring, human-review queue). `overridden` on `triage` plus `hallucination_suspected` on any target auto-enqueues the analysis for AI-ops review.

### 4.4 `POST /v1/assist/analyses/{id}:reanalyze`

Re-run with current artifact versions or explicit `{model/prompt pins}` (e.g., appeals reconstructing what the reviewer saw vs. what current models say — both records retained, never overwritten).

## 5. Eventing

Provider emits on `sim.ai.interaction`: `AnalysisStarted`, `AnalysisCompleted{analysis_id, blocks, abstentions, latency}`, `FeedbackRecorded`, `ThresholdAbstained`. Audit consumes all; AI-ops dashboards aggregate; Qualitron MAY consume extraction-persisted notifications via `sim.evidence` (the fabric write emits `EvidenceAdded{source: revital}` — see C-3).

## 6. Failure & degradation

Pipeline activity failures yield `status: partial` with explicit per-block `failed/abstained` — the reviewer workspace renders available blocks and a clear "AI analysis incomplete" banner. C-2 unavailability never blocks case progress (the workflow's `request_revital_analysis` action is fire-and-track). Re-tries are provider-internal; consumers do not retry `analyses` POSTs except on 5xx without operation creation (idempotency key protects).

## 7. Versioning, testing, GA gate

Additive-within-major rules as C-1 §7. Consumer-driven contracts: Enstellar pins the result shape (esp. INV-1/2/3 schema constraints) and the disabled-tenant 409 path. Provider gate:
- [ ] Schema-level enforcement of INV-1..4 demonstrated (mutation tests: uncited assertion cannot serialize)
- [ ] Abstention paths exercised end-to-end incl. workspace rendering
- [ ] Disablement per tenant/workflow verified without workflow breakage
- [ ] Red-team suite: prompt-injection content in documents cannot alter `triage` enum, escape citations, or trigger tool side-effects
- [ ] Every analysis reproducible: `interaction.input_manifest` hashes + pins re-run yields comparable record (modulo model nondeterminism, which is why the *record*, not the output, is the audit object)
