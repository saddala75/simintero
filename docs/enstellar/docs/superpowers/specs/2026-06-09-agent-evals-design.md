# SP7: Agent Evals Design Spec

**Status:** Approved (2026-06-09). Implements SP7 of the design-partner readiness program.

**Goal:** Graduate the existing synthetic eval stub to a real eval harness — 30 ground-truth cases, seven tracked metrics across completeness agent + triage agent + guardrail engine, configurable real/mock adapter, JSON + markdown reporting with run-over-run deltas, and a `make eval` target with `workflow_dispatch` CI.

**Invariant note:** This harness is a pure consumer of the agent layer. It calls agents and reads guardrail outputs. It does NOT modify `guardrails/engine.py`, `guardrails/rules.py`, or any agent implementation. Any future change that modifies those files requires mandatory senior engineer review per CLAUDE.md.

---

## 1. Architecture

The harness lives entirely within `services/agent-layer/evals/`, extending the existing stub. No stack required — the runner invokes agent functions in-process using the same `ModelAdapter` and `GuardrailEngine` the production service uses.

```
services/agent-layer/evals/
├── dataset/
│   ├── base.py          # DatasetLoader ABC: load() -> list[EvalCase]
│   ├── synthetic.py     # SyntheticDatasetLoader — 30 hand-crafted EvalCases
│   └── file_loader.py   # FileDatasetLoader(path) — accepts JSON/NDJSON for real cases
├── metrics/
│   ├── completeness.py  # groundedness, precision, recall, abstention_accuracy
│   ├── triage.py        # routing_accuracy
│   └── guardrails.py    # block_rate, false_positive_rate
├── runner.py            # load → invoke → score → report; reads EVAL_ADAPTER / EVAL_MODEL
├── report.py            # writes eval-{timestamp}.json + latest.md with deltas
├── results/             # gitignored except latest.md + latest.json
│   ├── latest.json      # prior-run baseline (for delta computation); committed
│   └── latest.md        # human-readable summary table; committed
└── test_completeness_eval.py  # existing file — unchanged
```

The runner is sequential (not parallel) to keep token usage predictable when using the real adapter.

---

## 2. Dataset

### EvalCase schema

```python
class EvalCase(BaseModel):
    case_id: str
    lob: str                      # commercial | medicare | medicaid
    urgency: str                  # standard | expedited | concurrent
    procedure_codes: list[str]    # CPT codes
    diagnosis_codes: list[str]    # ICD-10 codes
    doc_requirements: list[str]   # what the payer requires
    expected_gaps: list[str]      # ground-truth missing docs
    expected_queue: str           # clinical_review | medical_director | auto_approve
    should_abstain: bool          # True = agent should abstain on this case
```

PHI boundary enforced: `EvalCase` carries only codes, urgency, and LOB — no member names, DOBs, MRNs, NPIs, or provider identifiers. The runner builds `AgentInput` from these fields only.

### Synthetic dataset — 30 cases

| Partition | Count | Purpose |
|---|---|---|
| Well-specified | 15 | Clear gaps, citable criteria → groundedness + precision + recall |
| Ambiguous | 8 | Conflicting codes, no policy match → agent should abstain |
| Triage | 7 | Varied urgency/LOB combos → routing accuracy |

Cases overlap: all 30 have `expected_gaps` and `expected_queue`, so completeness and triage metrics run across the full set. Abstention metrics use only `should_abstain=True` cases (the 8 ambiguous ones).

### DatasetLoader interface

```python
class DatasetLoader(ABC):
    @abstractmethod
    def load(self) -> list[EvalCase]: ...
    
    @property
    @abstractmethod
    def version(self) -> str: ...
```

`SyntheticDatasetLoader` — hardcoded in `dataset/synthetic.py`, `version = "synthetic-v1"`.

`FileDatasetLoader(path: str)` — reads JSON array or NDJSON from disk, validates against `EvalCase` schema, `version` derived from filename. Stub only in SP7 — no real cases loaded yet.

---

## 3. Metrics & Thresholds

### 3a. Completeness agent (all 30 cases; skip abstentions for gap metrics)

| Metric | Formula | Threshold |
|---|---|---|
| `groundedness` | gaps_with_citation / total_detected_gaps | ≥ 0.80 |
| `precision` | \|detected ∩ expected\| / \|detected\| | ≥ 0.75 |
| `recall` | \|detected ∩ expected\| / \|expected\| | ≥ 0.70 |
| `abstention_accuracy` | correct_abstentions / should_abstain_cases | ≥ 0.85 |

### 3b. Triage agent (all 30 cases)

| Metric | Formula | Threshold |
|---|---|---|
| `routing_accuracy` | predicted_queue == expected_queue / total_cases | ≥ 0.80 |

### 3c. Guardrail engine (synthetic fixture set — 20 `AgentOutput` objects)

The guardrail metrics use a separate fixture set of 20 synthetic `AgentOutput` objects (10 intentionally invalid: confidence < 0.5 or missing citations; 10 valid), injected directly into `GuardrailEngine.evaluate()` — no agent call needed for these.

| Metric | Formula | Threshold |
|---|---|---|
| `guardrail_block_rate` | blocked_invalid / total_invalid | ≥ 0.90 |
| `guardrail_fp_rate` | blocked_valid / total_valid | ≤ 0.05 |

The run fails (exit code 1) if any single metric misses its threshold.

---

## 4. Adapter Selection & Runner

### Adapter configuration

```bash
EVAL_ADAPTER=mock        # default — uses existing mock adapters (fast, free)
EVAL_ADAPTER=anthropic   # real Claude API
EVAL_MODEL=claude-haiku-4-5-20251001  # optional model override
```

The runner instantiates via the existing `ModelAdapterFactory`:

```python
adapter = ModelAdapterFactory.create(
    provider=os.environ.get("EVAL_ADAPTER", "mock"),
    model=os.environ.get("EVAL_MODEL"),
)
```

### Runner pipeline

```
load_dataset()
  → for each EvalCase:
      build AgentInput (codes + urgency + lob only — PHI boundary enforced)
      run completeness_agent.run(input, adapter) → AgentOutput
      run triage_agent.run(input, adapter) → AgentOutput
  → run guardrail fixture set through GuardrailEngine.evaluate()
  → compute_metrics(all_outputs, dataset)
  → generate_report(metrics, run_metadata)
  → exit(0 if all passed else 1)
```

Sequential execution — no async fan-out — so `EVAL_ADAPTER=anthropic` token usage is bounded and predictable.

---

## 5. Report

### `evals/results/eval-{timestamp}.json`

Full machine-readable result, uploaded as CI artifact.

```json
{
  "run_id": "2026-06-09T14:32:00Z",
  "adapter": "anthropic",
  "model": "claude-haiku-4-5-20251001",
  "dataset_version": "synthetic-v1",
  "passed": true,
  "metrics": {
    "groundedness":         {"score": 0.87, "threshold": 0.80, "passed": true},
    "precision":            {"score": 0.79, "threshold": 0.75, "passed": true},
    "recall":               {"score": 0.72, "threshold": 0.70, "passed": true},
    "abstention_accuracy":  {"score": 0.88, "threshold": 0.85, "passed": true},
    "routing_accuracy":     {"score": 0.83, "threshold": 0.80, "passed": true},
    "guardrail_block_rate": {"score": 0.95, "threshold": 0.90, "passed": true},
    "guardrail_fp_rate":    {"score": 0.02, "threshold": 0.05, "passed": true}
  },
  "cases": [
    {
      "case_id": "syn-001",
      "gaps_detected": ["...", "..."],
      "gaps_expected": ["...", "..."],
      "queue_predicted": "clinical_review",
      "queue_expected": "clinical_review",
      "abstained": false,
      "citations": ["..."]
    }
  ]
}
```

### `evals/results/latest.md`

Human-readable markdown table committed to the repo. Delta computed against `latest.json` (prior run baseline).

```
## Agent Eval Results — 2026-06-09T14:32:00Z
Adapter: anthropic | Model: claude-haiku-4-5-20251001 | Dataset: synthetic-v1

| Metric               | Score | Threshold | Δ      | Status |
|----------------------|-------|-----------|--------|--------|
| Groundedness         | 0.87  | ≥ 0.80    | +0.04  | ✅     |
| Precision            | 0.79  | ≥ 0.75    | -0.01  | ✅     |
| Recall               | 0.72  | ≥ 0.70    | +0.02  | ✅     |
| Abstention accuracy  | 0.88  | ≥ 0.85    | +0.03  | ✅     |
| Routing accuracy     | 0.83  | ≥ 0.80    | +0.00  | ✅     |
| Guardrail block rate | 0.95  | ≥ 0.90    | +0.05  | ✅     |
| Guardrail FP rate    | 0.02  | ≤ 0.05    | -0.01  | ✅     |

Overall: PASSED (7/7)
```

`evals/results/` is gitignored except `latest.md` and `latest.json`.

---

## 6. `make eval` + CI

### Makefile targets

```makefile
## Run agent evals (mock adapter by default; fast, no API cost).
## Use EVAL_ADAPTER=anthropic for real model signal.
eval:
	uv run --project services/agent-layer python -m evals.runner

## Run evals against real Claude API (requires ANTHROPIC_API_KEY).
eval-real:
	EVAL_ADAPTER=anthropic uv run --project services/agent-layer python -m evals.runner
```

### `.github/workflows/eval.yml`

`workflow_dispatch` only — no scheduled trigger.

```yaml
name: Agent Evals

on:
  workflow_dispatch:
    inputs:
      adapter:
        description: 'Model adapter (mock or anthropic)'
        default: mock
        required: true
      model:
        description: 'Model override (leave blank for default)'
        default: ''
        required: false

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install uv
      - name: Run evals
        run: make eval
        env:
          EVAL_ADAPTER: ${{ inputs.adapter }}
          EVAL_MODEL:   ${{ inputs.model }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Upload eval results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: services/agent-layer/evals/results/
          retention-days: 30
      - name: Commit latest.md (real adapter only)
        if: inputs.adapter == 'anthropic'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add services/agent-layer/evals/results/latest.md \
                  services/agent-layer/evals/results/latest.json
          git diff --staged --quiet || git commit -m "eval: update latest results [skip ci]"
          git push
```

---

## 7. Files Created / Modified

| Path | Action |
|---|---|
| `services/agent-layer/evals/dataset/base.py` | Create — `DatasetLoader` ABC |
| `services/agent-layer/evals/dataset/synthetic.py` | Create — 30 `EvalCase` fixtures |
| `services/agent-layer/evals/dataset/file_loader.py` | Create — `FileDatasetLoader` stub |
| `services/agent-layer/evals/metrics/completeness.py` | Create — 4 completeness metrics |
| `services/agent-layer/evals/metrics/triage.py` | Create — routing accuracy |
| `services/agent-layer/evals/metrics/guardrails.py` | Create — block rate + FP rate |
| `services/agent-layer/evals/runner.py` | Create — orchestration pipeline |
| `services/agent-layer/evals/report.py` | Create — JSON + markdown report generation |
| `services/agent-layer/evals/results/latest.json` | Create — initial empty baseline |
| `services/agent-layer/evals/results/latest.md` | Create — initial empty baseline |
| `services/agent-layer/evals/results/.gitignore` | Create — ignore all except latest.* |
| `services/agent-layer/evals/test_completeness_eval.py` | Unchanged |
| `Makefile` | Modify — add `eval` and `eval-real` targets |
| `.github/workflows/eval.yml` | Create — `workflow_dispatch` CI job |

---

## 8. Definition of Done

- `make eval` exits 0 with mock adapter; all 7 metrics computed and logged.
- `make eval-real` exits 0 with `EVAL_ADAPTER=anthropic`; `latest.md` updated with real scores.
- `evals/results/latest.md` committed and readable as a design-partner artifact.
- `workflow_dispatch` trigger works in GitHub Actions; results uploaded as artifact.
- PHI boundary enforced: no member/provider identifiers in any eval case or log line.
- Guardrail engine source files (`engine.py`, `rules.py`) untouched.
