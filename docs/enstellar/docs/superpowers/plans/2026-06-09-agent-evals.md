# SP7: Agent Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real eval harness — 30 ground-truth cases, seven tracked metrics across completeness agent + triage agent + guardrail engine, configurable real/mock adapter, JSON + markdown reporting with run-over-run deltas, and a `make eval` target with `workflow_dispatch` CI.

**Architecture:** The harness lives entirely in `services/agent-layer/evals/`, calling the production `ModelAdapter`/`GuardrailEngine` in-process — no stack required. A `SyntheticDatasetLoader` provides 30 hand-crafted `EvalCase` fixtures (15 well-specified, 8 ambiguous, 7 triage). Three private mock adapters in `runner.py` exercise the correct signal paths so all 7 metrics pass thresholds with `EVAL_ADAPTER=mock`.

**Tech Stack:** Python 3.12, Pydantic v2, LangGraph (`build_graph`/`build_triage_graph`), `pytest-asyncio`, existing `ModelAdapter`/`GuardrailEngine`/`AgentSettings` from `enstellar_agents`.

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `services/agent-layer/evals/dataset/__init__.py` | Create | Package marker |
| `services/agent-layer/evals/dataset/base.py` | Create | `EvalCase` schema + `DatasetLoader` ABC |
| `services/agent-layer/evals/dataset/synthetic.py` | Create | `SyntheticDatasetLoader` — 30 fixtures |
| `services/agent-layer/evals/dataset/file_loader.py` | Create | `FileDatasetLoader` stub |
| `services/agent-layer/evals/metrics/__init__.py` | Create | Package marker |
| `services/agent-layer/evals/metrics/completeness.py` | Create | groundedness, precision, recall, abstention_accuracy |
| `services/agent-layer/evals/metrics/triage.py` | Create | routing_accuracy |
| `services/agent-layer/evals/metrics/guardrails.py` | Create | block_rate, fp_rate + 20 fixtures |
| `services/agent-layer/evals/runner.py` | Create | Mock adapters + async pipeline + main() |
| `services/agent-layer/evals/report.py` | Create | JSON + markdown output + delta computation |
| `services/agent-layer/evals/results/.gitignore` | Create | Track only latest.md + latest.json |
| `services/agent-layer/evals/results/latest.json` | Create | Empty baseline `{}` |
| `services/agent-layer/evals/results/latest.md` | Create | Placeholder markdown |
| `services/agent-layer/evals/test_dataset.py` | Create | Dataset tests |
| `services/agent-layer/evals/test_metrics.py` | Create | Metric formula tests |
| `services/agent-layer/evals/test_runner.py` | Create | Runner integration tests |
| `Makefile` | Modify | Add `eval` and `eval-real` targets |
| `.github/workflows/eval.yml` | Create | `workflow_dispatch` CI job |

**Never touch:** `evals/test_completeness_eval.py`, `guardrails/engine.py`, `guardrails/rules.py`, any agent implementation.

---

### Task 1: EvalCase schema + DatasetLoader ABC

**Files:**
- Create: `services/agent-layer/evals/dataset/__init__.py`
- Create: `services/agent-layer/evals/dataset/base.py`
- Create: `services/agent-layer/evals/test_dataset.py` (partial — add to in later tasks)

- [ ] **Step 1.1: Write the failing test**

Create `services/agent-layer/evals/test_dataset.py`:

```python
"""Tests for dataset schema and loader interface."""
from __future__ import annotations

import inspect

from evals.dataset.base import DatasetLoader, EvalCase


def test_evalcase_construction():
    case = EvalCase(
        case_id="test-001",
        lob="commercial",
        urgency="standard",
        procedure_codes=["27447"],
        diagnosis_codes=["M17.11"],
        doc_requirements=["operative_report"],
        expected_gaps=["operative_report"],
        expected_queue="clinical_review",
        should_abstain=False,
    )
    assert case.case_id == "test-001"
    assert case.lob == "commercial"
    assert not case.should_abstain


def test_evalcase_abstain_flag():
    case = EvalCase(
        case_id="test-002",
        lob="medicaid",
        urgency="standard",
        procedure_codes=["99213"],
        diagnosis_codes=["Z00.00"],
        doc_requirements=[],
        expected_gaps=[],
        expected_queue="clinical_review",
        should_abstain=True,
    )
    assert case.should_abstain
    assert case.expected_gaps == []


def test_datasetloader_is_abstract():
    assert inspect.isabstract(DatasetLoader)
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py -v 2>&1 | head -20
```
Expected: `ModuleNotFoundError: No module named 'evals.dataset'`

- [ ] **Step 1.3: Create package marker**

Create `services/agent-layer/evals/dataset/__init__.py` — empty file.

- [ ] **Step 1.4: Implement EvalCase + DatasetLoader ABC**

Create `services/agent-layer/evals/dataset/base.py`:

```python
"""EvalCase schema and DatasetLoader ABC."""
from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class EvalCase(BaseModel):
    case_id: str
    lob: str                    # commercial | medicare | medicaid
    urgency: str                # standard | expedited | concurrent
    procedure_codes: list[str]  # CPT codes
    diagnosis_codes: list[str]  # ICD-10 codes
    doc_requirements: list[str] # payer-required document types
    expected_gaps: list[str]    # ground-truth missing docs
    expected_queue: str         # clinical_review | medical_director | auto_approve
    should_abstain: bool        # True = completeness agent should abstain


class DatasetLoader(ABC):
    @abstractmethod
    def load(self) -> list[EvalCase]: ...

    @property
    @abstractmethod
    def version(self) -> str: ...
```

- [ ] **Step 1.5: Run test to confirm it passes**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py::test_evalcase_construction evals/test_dataset.py::test_evalcase_abstain_flag evals/test_dataset.py::test_datasetloader_is_abstract -v
```
Expected: `3 passed`

- [ ] **Step 1.6: Commit**

```bash
git add services/agent-layer/evals/dataset/__init__.py services/agent-layer/evals/dataset/base.py services/agent-layer/evals/test_dataset.py
git commit -m "feat(evals): EvalCase schema + DatasetLoader ABC"
```

---

### Task 2: Synthetic dataset — 30 ground-truth cases

**Files:**
- Create: `services/agent-layer/evals/dataset/synthetic.py`
- Modify: `services/agent-layer/evals/test_dataset.py` (add synthetic dataset tests)

The triage mock maps `urgency` → queue: `standard`→`clinical_review`, `expedited`→`medical_director`, `concurrent`→`auto_approve`. All 30 `expected_queue` values must match this mapping. PHI boundary: codes, urgency, LOB only — no member/provider identifiers.

- [ ] **Step 2.1: Write the failing tests**

Append to `services/agent-layer/evals/test_dataset.py`:

```python
from evals.dataset.synthetic import SyntheticDatasetLoader


def test_synthetic_loads_30_cases():
    loader = SyntheticDatasetLoader()
    cases = loader.load()
    assert len(cases) == 30


def test_synthetic_case_ids_unique():
    cases = SyntheticDatasetLoader().load()
    ids = [c.case_id for c in cases]
    assert len(ids) == len(set(ids))


def test_synthetic_partition_counts():
    cases = SyntheticDatasetLoader().load()
    well_specified = [c for c in cases if c.case_id.startswith("syn-0") and int(c.case_id.split("-")[1]) <= 15]
    ambiguous = [c for c in cases if c.should_abstain]
    triage = [c for c in cases if c.case_id.startswith("syn-0") and int(c.case_id.split("-")[1]) >= 24]
    assert len(well_specified) == 15
    assert len(ambiguous) == 8
    assert len(triage) == 7


def test_synthetic_queue_matches_urgency():
    queue_map = {"standard": "clinical_review", "expedited": "medical_director", "concurrent": "auto_approve"}
    for case in SyntheticDatasetLoader().load():
        assert case.expected_queue == queue_map[case.urgency], (
            f"{case.case_id}: urgency={case.urgency} but expected_queue={case.expected_queue}"
        )


def test_synthetic_ambiguous_cases_have_empty_docs():
    for case in SyntheticDatasetLoader().load():
        if case.should_abstain:
            assert case.doc_requirements == []
            assert case.expected_gaps == []


def test_synthetic_non_ambiguous_gaps_equal_requirements():
    for case in SyntheticDatasetLoader().load():
        if not case.should_abstain:
            assert set(case.expected_gaps) == set(case.doc_requirements), (
                f"{case.case_id}: expected_gaps != doc_requirements"
            )


def test_synthetic_version():
    assert SyntheticDatasetLoader().version == "synthetic-v1"
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py -k "synthetic" -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.dataset.synthetic'`

- [ ] **Step 2.3: Implement the 30 synthetic cases**

Create `services/agent-layer/evals/dataset/synthetic.py`:

```python
"""SyntheticDatasetLoader — 30 hand-crafted EvalCases for agent eval harness."""
from __future__ import annotations

from evals.dataset.base import DatasetLoader, EvalCase

# PHI boundary: codes, urgency, LOB only — no member names, DOBs, NPIs, MRNs.
# Queue mapping enforced: standard→clinical_review, expedited→medical_director, concurrent→auto_approve.

_CASES: list[dict] = [
    # ── Well-specified (001–015): clear gaps, citable criteria ──────────────
    {
        "case_id": "syn-001", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["27447"], "diagnosis_codes": ["M17.11"],
        "doc_requirements": ["operative_report", "clinical_notes", "imaging_report"],
        "expected_gaps": ["operative_report", "clinical_notes", "imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-002", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["27130"], "diagnosis_codes": ["M16.11"],
        "doc_requirements": ["operative_report", "pre_auth_form", "imaging_report"],
        "expected_gaps": ["operative_report", "pre_auth_form", "imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-003", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["33534"], "diagnosis_codes": ["I25.10"],
        "doc_requirements": ["cath_report", "echo_report", "cardiac_consult"],
        "expected_gaps": ["cath_report", "echo_report", "cardiac_consult"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-004", "lob": "medicare", "urgency": "expedited",
        "procedure_codes": ["33533"], "diagnosis_codes": ["I25.110"],
        "doc_requirements": ["cardiac_stress_test", "echo_report"],
        "expected_gaps": ["cardiac_stress_test", "echo_report"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-005", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["71250"], "diagnosis_codes": ["J18.1"],
        "doc_requirements": ["radiology_rx", "prior_imaging_report"],
        "expected_gaps": ["radiology_rx", "prior_imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-006", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["93306"], "diagnosis_codes": ["I48.0"],
        "doc_requirements": ["cardiology_consult", "ecg_report"],
        "expected_gaps": ["cardiology_consult", "ecg_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-007", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["27440"], "diagnosis_codes": ["M17.31"],
        "doc_requirements": ["physical_therapy_notes", "radiology_report"],
        "expected_gaps": ["physical_therapy_notes", "radiology_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-008", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["47562"], "diagnosis_codes": ["K80.20"],
        "doc_requirements": ["ultrasound_report", "surgical_consult"],
        "expected_gaps": ["ultrasound_report", "surgical_consult"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-009", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["70553"], "diagnosis_codes": ["G35"],
        "doc_requirements": ["neuro_consult", "prior_mri_report"],
        "expected_gaps": ["neuro_consult", "prior_mri_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-010", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["43239"], "diagnosis_codes": ["K25.0"],
        "doc_requirements": ["gi_consult", "lab_results"],
        "expected_gaps": ["gi_consult", "lab_results"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-011", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["66984"], "diagnosis_codes": ["H26.9"],
        "doc_requirements": ["ophthalmology_exam", "visual_acuity_test"],
        "expected_gaps": ["ophthalmology_exam", "visual_acuity_test"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-012", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["58150"], "diagnosis_codes": ["N80.1"],
        "doc_requirements": ["gyn_consult", "pelvic_ultrasound", "lab_results"],
        "expected_gaps": ["gyn_consult", "pelvic_ultrasound", "lab_results"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-013", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["26116"], "diagnosis_codes": ["M67.40"],
        "doc_requirements": ["radiology_report", "surgical_consult"],
        "expected_gaps": ["radiology_report", "surgical_consult"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-014", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["27403"], "diagnosis_codes": ["M23.202"],
        "doc_requirements": ["mri_report", "orthopedic_consult"],
        "expected_gaps": ["mri_report", "orthopedic_consult"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-015", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["29827"], "diagnosis_codes": ["M75.10"],
        "doc_requirements": ["mri_shoulder_report", "orthopedic_consult", "physical_therapy_record"],
        "expected_gaps": ["mri_shoulder_report", "orthopedic_consult", "physical_therapy_record"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    # ── Ambiguous (016–023): conflicting/unspecified codes → agent should abstain ──
    {
        "case_id": "syn-016", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99213"], "diagnosis_codes": ["Z00.00"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-017", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["97110"], "diagnosis_codes": ["M54.5"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-018", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["99214"], "diagnosis_codes": ["E11.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-019", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99215"], "diagnosis_codes": ["F32.1"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-020", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["90837"], "diagnosis_codes": ["F32.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-021", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["97016"], "diagnosis_codes": ["M54.2"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-022", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["97014"], "diagnosis_codes": ["M54.3"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-023", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99232"], "diagnosis_codes": ["R05.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    # ── Triage (024–030): varied urgency/LOB, routing focus ──────────────────
    {
        "case_id": "syn-024", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["33533"], "diagnosis_codes": ["I25.10"],
        "doc_requirements": ["cardiac_catheterization_report"],
        "expected_gaps": ["cardiac_catheterization_report"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-025", "lob": "medicare", "urgency": "concurrent",
        "procedure_codes": ["71250"], "diagnosis_codes": ["J18.9"],
        "doc_requirements": ["radiology_prescription"],
        "expected_gaps": ["radiology_prescription"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
    {
        "case_id": "syn-026", "lob": "medicaid", "urgency": "concurrent",
        "procedure_codes": ["27447"], "diagnosis_codes": ["M17.11"],
        "doc_requirements": ["operative_report"],
        "expected_gaps": ["operative_report"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
    {
        "case_id": "syn-027", "lob": "medicare", "urgency": "expedited",
        "procedure_codes": ["93306"], "diagnosis_codes": ["I48.91"],
        "doc_requirements": ["cardiology_consultation_note"],
        "expected_gaps": ["cardiology_consultation_note"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-028", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["70553"], "diagnosis_codes": ["G35"],
        "doc_requirements": ["neurology_consultation_note"],
        "expected_gaps": ["neurology_consultation_note"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-029", "lob": "medicaid", "urgency": "expedited",
        "procedure_codes": ["47562"], "diagnosis_codes": ["K80.20"],
        "doc_requirements": ["surgical_consultation_note"],
        "expected_gaps": ["surgical_consultation_note"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-030", "lob": "commercial", "urgency": "concurrent",
        "procedure_codes": ["58150"], "diagnosis_codes": ["N80.0"],
        "doc_requirements": ["gynecology_consultation_note"],
        "expected_gaps": ["gynecology_consultation_note"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
]


class SyntheticDatasetLoader(DatasetLoader):
    """30 hand-crafted EvalCases covering well-specified, ambiguous, and triage partitions."""

    def load(self) -> list[EvalCase]:
        return [EvalCase(**c) for c in _CASES]

    @property
    def version(self) -> str:
        return "synthetic-v1"
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py -v
```
Expected: `9 passed`

- [ ] **Step 2.5: Commit**

```bash
git add services/agent-layer/evals/dataset/synthetic.py services/agent-layer/evals/test_dataset.py
git commit -m "feat(evals): SyntheticDatasetLoader — 30 ground-truth EvalCases"
```

---

### Task 3: FileDatasetLoader stub

**Files:**
- Create: `services/agent-layer/evals/dataset/file_loader.py`
- Modify: `services/agent-layer/evals/test_dataset.py` (add file loader tests)

- [ ] **Step 3.1: Write the failing test**

Append to `services/agent-layer/evals/test_dataset.py`:

```python
import json
import tempfile

from evals.dataset.file_loader import FileDatasetLoader


def test_file_loader_reads_json_array(tmp_path):
    data = [
        {
            "case_id": "file-001", "lob": "commercial", "urgency": "standard",
            "procedure_codes": ["27447"], "diagnosis_codes": ["M17.11"],
            "doc_requirements": ["op_report"], "expected_gaps": ["op_report"],
            "expected_queue": "clinical_review", "should_abstain": False,
        }
    ]
    p = tmp_path / "cases.json"
    p.write_text(json.dumps(data))
    loader = FileDatasetLoader(str(p))
    cases = loader.load()
    assert len(cases) == 1
    assert cases[0].case_id == "file-001"


def test_file_loader_version_from_filename(tmp_path):
    p = tmp_path / "my-dataset-v2.json"
    p.write_text("[]")
    loader = FileDatasetLoader(str(p))
    assert loader.version == "my-dataset-v2"
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py -k "file_loader" -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.dataset.file_loader'`

- [ ] **Step 3.3: Implement FileDatasetLoader**

Create `services/agent-layer/evals/dataset/file_loader.py`:

```python
"""FileDatasetLoader — loads EvalCases from a JSON array file."""
from __future__ import annotations

import json
from pathlib import Path

from evals.dataset.base import DatasetLoader, EvalCase


class FileDatasetLoader(DatasetLoader):
    """Load eval cases from a JSON array file.

    Accepts a path to a JSON file containing an array of EvalCase-compatible dicts.
    ``version`` is derived from the file stem (filename without extension).

    Stub for SP7 — no real cases loaded in this release.
    """

    def __init__(self, path: str) -> None:
        self._path = Path(path)

    def load(self) -> list[EvalCase]:
        with open(self._path) as f:
            data = json.load(f)
        return [EvalCase.model_validate(item) for item in data]

    @property
    def version(self) -> str:
        return self._path.stem
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/test_dataset.py -v
```
Expected: `11 passed`

- [ ] **Step 3.5: Commit**

```bash
git add services/agent-layer/evals/dataset/file_loader.py services/agent-layer/evals/test_dataset.py
git commit -m "feat(evals): FileDatasetLoader stub for future real-case datasets"
```

---

### Task 4: Completeness metrics

**Files:**
- Create: `services/agent-layer/evals/metrics/__init__.py`
- Create: `services/agent-layer/evals/metrics/completeness.py`
- Create: `services/agent-layer/evals/test_metrics.py`

- [ ] **Step 4.1: Write the failing tests**

Create `services/agent-layer/evals/test_metrics.py`:

```python
"""Tests for eval metric functions — deterministic formula verification."""
from __future__ import annotations

from uuid import uuid4

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase
from evals.metrics.completeness import compute_completeness_metrics


def _case(case_id, doc_reqs, expected_gaps, urgency="standard", should_abstain=False):
    return EvalCase(
        case_id=case_id, lob="commercial", urgency=urgency,
        procedure_codes=["27447"], diagnosis_codes=["M17.11"],
        doc_requirements=doc_reqs, expected_gaps=expected_gaps,
        expected_queue="clinical_review", should_abstain=should_abstain,
    )


def _output(confidence, citations, abstained, gaps):
    return AgentOutput(
        agent_id="test-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=confidence, citations=citations, abstained=abstained,
        abstention_reason="low confidence" if abstained else None,
        result={"gaps": gaps} if not abstained else None,
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )


def test_groundedness_perfect():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["cite1"], False, [{"required_document_type": "op_report", "citation": "cite1"}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["groundedness"]["score"] == 1.0
    assert m["groundedness"]["passed"]


def test_groundedness_zero_when_no_citations():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["cite1"], False, [{"required_document_type": "op_report", "citation": ""}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["groundedness"]["score"] == 0.0
    assert not m["groundedness"]["passed"]


def test_precision_perfect():
    cases = [_case("c1", ["op_report", "clinical_notes"], ["op_report", "clinical_notes"])]
    outputs = [_output(0.9, ["c"], False, [
        {"required_document_type": "op_report", "citation": "c"},
        {"required_document_type": "clinical_notes", "citation": "c"},
    ])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["precision"]["score"] == 1.0
    assert m["precision"]["passed"]


def test_precision_partial():
    # detected=[A, B, C], expected=[A, B] → precision = 2/3 ≈ 0.667 < 0.75
    cases = [_case("c1", ["A", "B", "C"], ["A", "B"])]
    # But test_synthetic_non_ambiguous_gaps_equal_requirements prevents this in production dataset.
    # This test verifies the formula is correct.
    outputs = [_output(0.9, ["c"], False, [
        {"required_document_type": "A", "citation": "c"},
        {"required_document_type": "B", "citation": "c"},
        {"required_document_type": "C", "citation": "c"},
    ])]
    m = compute_completeness_metrics(outputs, cases)
    assert abs(m["precision"]["score"] - 0.6667) < 0.001
    assert not m["precision"]["passed"]


def test_recall_perfect():
    cases = [_case("c1", ["op_report"], ["op_report"])]
    outputs = [_output(0.9, ["c"], False, [{"required_document_type": "op_report", "citation": "c"}])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["recall"]["score"] == 1.0
    assert m["recall"]["passed"]


def test_abstention_accuracy_perfect():
    cases = [_case("c1", [], [], should_abstain=True)]
    outputs = [_output(0.3, [], True, [])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["abstention_accuracy"]["score"] == 1.0
    assert m["abstention_accuracy"]["passed"]


def test_abstention_accuracy_zero():
    cases = [_case("c1", [], [], should_abstain=True)]
    # Agent did NOT abstain when it should have
    outputs = [_output(0.9, ["c"], False, [])]
    m = compute_completeness_metrics(outputs, cases)
    assert m["abstention_accuracy"]["score"] == 0.0
    assert not m["abstention_accuracy"]["passed"]


def test_abstaining_cases_excluded_from_gap_metrics():
    cases = [_case("c1", [], [], should_abstain=True)]
    outputs = [_output(0.3, [], True, [])]
    m = compute_completeness_metrics(outputs, cases)
    # No gaps → groundedness, precision, recall all default to 0.0 but not counted as pass/fail
    # since there are no non-abstaining cases
    assert m["groundedness"]["score"] == 0.0
    assert m["precision"]["score"] == 0.0
    assert m["recall"]["score"] == 0.0
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.metrics'`

- [ ] **Step 4.3: Create package marker**

Create `services/agent-layer/evals/metrics/__init__.py` — empty file.

- [ ] **Step 4.4: Implement completeness metrics**

Create `services/agent-layer/evals/metrics/completeness.py`:

```python
"""Completeness agent evaluation metrics."""
from __future__ import annotations

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

THRESHOLDS: dict[str, float] = {
    "groundedness": 0.80,
    "precision": 0.75,
    "recall": 0.70,
    "abstention_accuracy": 0.85,
}


def compute_completeness_metrics(
    outputs: list[AgentOutput],
    cases: list[EvalCase],
) -> dict[str, dict]:
    """Compute groundedness, precision, recall, abstention_accuracy.

    Gap metrics (groundedness, precision, recall) skip abstaining cases.
    abstention_accuracy only counts cases where should_abstain=True.
    """
    assert len(outputs) == len(cases), "outputs and cases must have equal length"

    total_gaps = 0
    grounded_gaps = 0
    total_detected = 0
    total_expected = 0
    true_positives = 0
    should_abstain_count = 0
    correct_abstentions = 0

    for output, case in zip(outputs, cases):
        if case.should_abstain:
            should_abstain_count += 1
            if output.abstained:
                correct_abstentions += 1
            continue  # skip gap metrics for expected-abstain cases

        if output.abstained:
            continue  # unexpected abstention — skip gap metrics for this case

        gaps = output.result.get("gaps", []) if output.result else []
        expected_set = set(case.expected_gaps)

        for gap in gaps:
            total_gaps += 1
            if gap.get("citation"):
                grounded_gaps += 1
            dt = gap.get("required_document_type", "")
            total_detected += 1
            if dt in expected_set:
                true_positives += 1

        total_expected += len(expected_set)

    groundedness = grounded_gaps / total_gaps if total_gaps > 0 else 0.0
    precision = true_positives / total_detected if total_detected > 0 else 0.0
    recall = true_positives / total_expected if total_expected > 0 else 0.0
    abstention_accuracy = (
        correct_abstentions / should_abstain_count if should_abstain_count > 0 else 0.0
    )

    def _score(key: str, value: float) -> dict:
        return {
            "score": round(value, 4),
            "threshold": THRESHOLDS[key],
            "passed": value >= THRESHOLDS[key],
        }

    return {
        "groundedness": _score("groundedness", groundedness),
        "precision": _score("precision", precision),
        "recall": _score("recall", recall),
        "abstention_accuracy": _score("abstention_accuracy", abstention_accuracy),
    }
```

- [ ] **Step 4.5: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -v
```
Expected: `8 passed`

- [ ] **Step 4.6: Commit**

```bash
git add services/agent-layer/evals/metrics/__init__.py services/agent-layer/evals/metrics/completeness.py services/agent-layer/evals/test_metrics.py
git commit -m "feat(evals): completeness metrics — groundedness, precision, recall, abstention_accuracy"
```

---

### Task 5: Triage metric

**Files:**
- Create: `services/agent-layer/evals/metrics/triage.py`
- Modify: `services/agent-layer/evals/test_metrics.py` (add triage tests)

- [ ] **Step 5.1: Write the failing tests**

Append to `services/agent-layer/evals/test_metrics.py`:

```python
from evals.metrics.triage import compute_triage_metrics


def test_routing_accuracy_perfect():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [_output(0.9, ["c"], False, [])]
    # Override result for triage: set suggested_queue
    outputs[0] = AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=0.9, citations=["c"], abstained=False,
        result={"suggested_queue": "clinical_review"},
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 1.0
    assert m["routing_accuracy"]["passed"]


def test_routing_accuracy_zero():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-test", case_id=uuid4(),
        confidence=0.9, citations=["c"], abstained=False,
        result={"suggested_queue": "medical_director"},  # wrong
        provenance={"model_name": "test", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 0.0
    assert not m["routing_accuracy"]["passed"]


def test_routing_accuracy_abstained_counts_as_wrong():
    cases = [_case("c1", [], [], urgency="standard")]
    outputs = [_output(0.3, [], True, [])]
    m = compute_triage_metrics(outputs, cases)
    assert m["routing_accuracy"]["score"] == 0.0
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -k "routing" -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.metrics.triage'`

- [ ] **Step 5.3: Implement triage metric**

Create `services/agent-layer/evals/metrics/triage.py`:

```python
"""Triage agent evaluation metrics."""
from __future__ import annotations

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

THRESHOLDS: dict[str, float] = {"routing_accuracy": 0.80}


def compute_triage_metrics(
    outputs: list[AgentOutput],
    cases: list[EvalCase],
) -> dict[str, dict]:
    """Compute routing_accuracy: fraction of cases where predicted queue matches expected."""
    assert len(outputs) == len(cases)

    correct = 0
    total = len(cases)

    for output, case in zip(outputs, cases):
        predicted = None
        if not output.abstained and output.result:
            predicted = output.result.get("suggested_queue")
        if predicted == case.expected_queue:
            correct += 1

    score = correct / total if total > 0 else 0.0
    return {
        "routing_accuracy": {
            "score": round(score, 4),
            "threshold": THRESHOLDS["routing_accuracy"],
            "passed": score >= THRESHOLDS["routing_accuracy"],
        }
    }
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -v
```
Expected: `11 passed`

- [ ] **Step 5.5: Commit**

```bash
git add services/agent-layer/evals/metrics/triage.py services/agent-layer/evals/test_metrics.py
git commit -m "feat(evals): triage routing_accuracy metric"
```

---

### Task 6: Guardrail metrics

**Files:**
- Create: `services/agent-layer/evals/metrics/guardrails.py`
- Modify: `services/agent-layer/evals/test_metrics.py` (add guardrail tests)

The 20-fixture set is defined inline: 5 low-confidence (confidence=0.6 < 0.7 threshold → blocked), 5 missing-citations (→ blocked), 10 valid (confidence=0.9, citations present → not blocked). Guardrail rules come from the unmodified `GuardrailEngine`.

- [ ] **Step 6.1: Write the failing tests**

Append to `services/agent-layer/evals/test_metrics.py`:

```python
from evals.metrics.guardrails import compute_guardrail_metrics


def test_guardrail_block_rate_passes_threshold():
    m = compute_guardrail_metrics()
    assert m["guardrail_block_rate"]["score"] >= 0.90
    assert m["guardrail_block_rate"]["passed"]


def test_guardrail_fp_rate_passes_threshold():
    m = compute_guardrail_metrics()
    assert m["guardrail_fp_rate"]["score"] <= 0.05
    assert m["guardrail_fp_rate"]["passed"]


def test_guardrail_low_confidence_fixtures_are_blocked():
    """Fixtures with confidence=0.6 (below 0.7 threshold) must be blocked."""
    from evals.metrics.guardrails import _make_fixtures
    from enstellar_agents.guardrails.engine import GuardrailEngine
    invalid, _ = _make_fixtures()
    low_conf = [f for f in invalid if f.confidence == 0.6]
    engine = GuardrailEngine()
    for f in low_conf:
        result = engine.check(f, "tenant-eval")
        assert not result.passed, f"Expected blocked but passed: {result.violations}"


def test_guardrail_valid_fixtures_are_not_blocked():
    from evals.metrics.guardrails import _make_fixtures
    from enstellar_agents.guardrails.engine import GuardrailEngine
    _, valid = _make_fixtures()
    engine = GuardrailEngine()
    for f in valid:
        result = engine.check(f, "tenant-eval")
        assert result.passed, f"False positive: {result.violations}"
```

- [ ] **Step 6.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -k "guardrail" -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.metrics.guardrails'`

- [ ] **Step 6.3: Implement guardrail metrics**

Create `services/agent-layer/evals/metrics/guardrails.py`:

```python
"""Guardrail engine evaluation metrics.

Uses a 20-fixture synthetic set injected directly into GuardrailEngine.check():
  - 10 invalid: 5 low-confidence (confidence=0.6 < 0.7 threshold) + 5 missing-citations
  - 10 valid:   confidence=0.9, citations present

block_rate = blocked_invalid / 10   (target ≥ 0.90)
fp_rate    = blocked_valid / 10     (target ≤ 0.05)
"""
from __future__ import annotations

from uuid import uuid4

from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.models import AgentOutput

THRESHOLDS: dict[str, float] = {
    "guardrail_block_rate": 0.90,
    "guardrail_fp_rate": 0.05,
}
_TENANT = "tenant-eval"
_PROVENANCE = {"model_name": "guardrail-fixture", "timestamp": "2026-06-09T00:00:00Z"}


def _make_fixtures() -> tuple[list[AgentOutput], list[AgentOutput]]:
    """Return (invalid_fixtures, valid_fixtures)."""
    invalid: list[AgentOutput] = []
    # 5 low-confidence fixtures — fails rule_confidence_threshold (0.6 < 0.7)
    for _ in range(5):
        invalid.append(AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.6,
            citations=["valid-citation"],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        ))
    # 5 missing-citations fixtures — fails rule_citations_required
    for _ in range(5):
        invalid.append(AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.8,
            citations=[],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        ))
    valid: list[AgentOutput] = [
        AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.9,
            citations=["CriteriaCorp/fixture/v2024"],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        )
        for _ in range(10)
    ]
    return invalid, valid


def compute_guardrail_metrics() -> dict[str, dict]:
    """Run the 20-fixture set through GuardrailEngine and return block_rate + fp_rate."""
    engine = GuardrailEngine()
    invalid, valid = _make_fixtures()

    blocked_invalid = sum(1 for f in invalid if not engine.check(f, _TENANT).passed)
    blocked_valid = sum(1 for f in valid if not engine.check(f, _TENANT).passed)

    block_rate = blocked_invalid / len(invalid)
    fp_rate = blocked_valid / len(valid)

    return {
        "guardrail_block_rate": {
            "score": round(block_rate, 4),
            "threshold": THRESHOLDS["guardrail_block_rate"],
            "passed": block_rate >= THRESHOLDS["guardrail_block_rate"],
        },
        "guardrail_fp_rate": {
            "score": round(fp_rate, 4),
            "threshold": THRESHOLDS["guardrail_fp_rate"],
            "passed": fp_rate <= THRESHOLDS["guardrail_fp_rate"],
        },
    }
```

- [ ] **Step 6.4: Run tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/test_metrics.py -v
```
Expected: `15 passed`

- [ ] **Step 6.5: Commit**

```bash
git add services/agent-layer/evals/metrics/guardrails.py services/agent-layer/evals/test_metrics.py
git commit -m "feat(evals): guardrail block_rate and fp_rate metrics with 20-fixture set"
```

---

### Task 7: Runner — mock adapters + orchestration pipeline

**Files:**
- Create: `services/agent-layer/evals/runner.py`
- Create: `services/agent-layer/evals/test_runner.py`

Three mock adapters live in `runner.py` (private, eval-only):
- `_CompGroundedAdapter` — parses `doc_requirements` from user message; returns all as gaps with citations; confidence=0.88
- `_CompAmbiguousAdapter` — returns confidence=0.3 (triggers abstention); no gaps
- `_TriageMockAdapter` — maps `urgency` from case_summary to `suggested_queue`; confidence=0.88

The runner uses `_CompAmbiguousAdapter` for `case.should_abstain=True` cases and `_CompGroundedAdapter` otherwise. `_TriageMockAdapter` is used for all triage runs.

- [ ] **Step 7.1: Write the failing tests**

Create `services/agent-layer/evals/test_runner.py`:

```python
"""Runner integration tests — verifies full pipeline with mock adapter."""
from __future__ import annotations

import pytest

from evals.metrics.completeness import compute_completeness_metrics
from evals.metrics.guardrails import compute_guardrail_metrics
from evals.metrics.triage import compute_triage_metrics
from evals.runner import _run_all


async def test_run_all_returns_30_outputs():
    comp_outputs, triage_outputs, cases = await _run_all("mock", None)
    assert len(comp_outputs) == 30
    assert len(triage_outputs) == 30
    assert len(cases) == 30


async def test_all_7_metrics_pass_with_mock_adapter():
    comp_outputs, triage_outputs, cases = await _run_all("mock", None)

    comp_m = compute_completeness_metrics(comp_outputs, cases)
    triage_m = compute_triage_metrics(triage_outputs, cases)
    guardrail_m = compute_guardrail_metrics()
    all_metrics = {**comp_m, **triage_m, **guardrail_m}

    assert len(all_metrics) == 7
    failed = [k for k, v in all_metrics.items() if not v["passed"]]
    assert failed == [], f"Metrics below threshold: {failed}"


async def test_ambiguous_cases_produce_abstained_comp_output():
    comp_outputs, _, cases = await _run_all("mock", None)
    for output, case in zip(comp_outputs, cases):
        if case.should_abstain:
            assert output.abstained, f"{case.case_id} should have abstained"


async def test_triage_outputs_never_abstain_with_mock():
    _, triage_outputs, cases = await _run_all("mock", None)
    for output, case in zip(triage_outputs, cases):
        assert not output.abstained, f"{case.case_id} triage should not abstain"


async def test_triage_predicted_queues_match_urgency():
    queue_map = {
        "standard": "clinical_review",
        "expedited": "medical_director",
        "concurrent": "auto_approve",
    }
    _, triage_outputs, cases = await _run_all("mock", None)
    for output, case in zip(triage_outputs, cases):
        predicted = output.result.get("suggested_queue") if output.result else None
        assert predicted == queue_map[case.urgency], (
            f"{case.case_id}: urgency={case.urgency}, expected {queue_map[case.urgency]}, got {predicted}"
        )
```

- [ ] **Step 7.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_runner.py -v 2>&1 | head -10
```
Expected: `ModuleNotFoundError: No module named 'evals.runner'`

- [ ] **Step 7.3: Implement runner.py**

Create `services/agent-layer/evals/runner.py`:

```python
"""Eval runner — loads dataset, invokes agents, computes metrics, generates report.

Usage:
    uv run --project services/agent-layer python -m evals.runner

Environment variables:
    EVAL_ADAPTER   mock (default) | anthropic
    EVAL_MODEL     optional model override (e.g. claude-haiku-4-5-20251001)
    ANTHROPIC_API_KEY  required when EVAL_ADAPTER=anthropic
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from uuid import uuid4

from enstellar_agents.agents.completeness import build_graph as build_completeness_graph
from enstellar_agents.agents.triage import build_triage_graph
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.models import AgentInput, AgentOutput

from evals.dataset.base import EvalCase
from evals.dataset.synthetic import SyntheticDatasetLoader
from evals.metrics.completeness import compute_completeness_metrics
from evals.metrics.guardrails import compute_guardrail_metrics
from evals.metrics.triage import compute_triage_metrics
from evals.report import generate_report

logger = logging.getLogger(__name__)


# ── Private mock adapters ────────────────────────────────────────────────────

class _CompGroundedAdapter(ModelAdapter):
    """Mock completeness adapter for non-ambiguous cases.

    Parses 'Required document types: a, b, c' from the user message and
    returns each as a gap with a citation. confidence=0.88 (above all thresholds).
    """

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        match = re.search(r"Required document types: (.+)$", user_message, re.MULTILINE)
        doc_types = [d.strip() for d in match.group(1).split(",")] if match else []
        return json.dumps({
            "gaps": [
                {
                    "description": f"Missing {dt}",
                    "required_document_type": dt,
                    "citation": f"CriteriaCorp/{dt}/v2024",
                }
                for dt in doc_types
            ],
            "rfi_draft": {
                "subject": "Documentation Request",
                "body": "Please provide the required clinical documentation.",
                "required_documents": doc_types,
                "due_date_days": 14,
            },
            "confidence": 0.88,
            "citations": [f"CriteriaCorp/{dt}/v2024" for dt in doc_types],
        })

    def model_name(self) -> str:
        return "eval-comp-grounded"


class _CompAmbiguousAdapter(ModelAdapter):
    """Mock completeness adapter for ambiguous cases.

    Returns confidence=0.3 — the completeness agent's parse_output node
    sets abstained=True because 0.3 < 0.4 (abstention threshold).
    """

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        return json.dumps({
            "gaps": [],
            "rfi_draft": {"subject": "", "body": "", "required_documents": [], "due_date_days": 14},
            "confidence": 0.3,
            "citations": [],
        })

    def model_name(self) -> str:
        return "eval-comp-ambiguous"


class _TriageMockAdapter(ModelAdapter):
    """Mock triage adapter for all cases.

    Parses 'urgency' from case_summary JSON and maps it to the expected queue.
    confidence=0.88 (above all thresholds) — never abstains.
    """

    _QUEUE_MAP = {
        "standard": "clinical_review",
        "expedited": "medical_director",
        "concurrent": "auto_approve",
    }

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        summary_json = user_message[len("Case summary: "):]
        case_summary = json.loads(summary_json)
        urgency = case_summary.get("urgency", "standard")
        queue = self._QUEUE_MAP.get(urgency, "clinical_review")
        return json.dumps({
            "suggested_queue": queue,
            "rationale": f"Routing to {queue} based on urgency={urgency}",
            "confidence": 0.88,
            "citations": [f"RoutingPolicy/urgency/{urgency}"],
        })

    def model_name(self) -> str:
        return "eval-triage"


# ── Adapter factory ──────────────────────────────────────────────────────────

def _get_real_adapter(eval_model: str | None) -> ModelAdapter:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter

    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ENSTELLAR_ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required when EVAL_ADAPTER=anthropic")

    settings = AgentSettings(
        model_provider="anthropic",
        model_name=eval_model or "claude-haiku-4-5-20251001",
        anthropic_api_key=api_key,
    )
    return get_adapter(settings)


# ── Per-case invocation ──────────────────────────────────────────────────────

async def _invoke_case(
    case: EvalCase,
    comp_adapter: ModelAdapter,
    triage_adapter: ModelAdapter,
) -> tuple[AgentOutput, AgentOutput]:
    inp = AgentInput(
        tenant_id="tenant-eval",
        case_id=uuid4(),
        case_summary={
            "procedure_code": case.procedure_codes[0] if case.procedure_codes else "",
            "diagnosis_codes": case.diagnosis_codes,
            "urgency": case.urgency,
            "lob": case.lob,
        },
        doc_requirements=case.doc_requirements,
        correlation_id=f"eval-{case.case_id}",
    )

    comp_graph = build_completeness_graph(comp_adapter)
    comp_state = await comp_graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    triage_graph = build_triage_graph(triage_adapter)
    triage_state = await triage_graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    return comp_state["agent_output"], triage_state["agent_output"]


# ── Main pipeline ────────────────────────────────────────────────────────────

async def _run_all(
    eval_adapter_name: str,
    eval_model: str | None,
) -> tuple[list[AgentOutput], list[AgentOutput], list[EvalCase]]:
    """Run the full eval pipeline and return (comp_outputs, triage_outputs, cases)."""
    loader = SyntheticDatasetLoader()
    cases = loader.load()

    real_adapter: ModelAdapter | None = None
    if eval_adapter_name == "anthropic":
        real_adapter = _get_real_adapter(eval_model)
    elif eval_adapter_name != "mock":
        raise ValueError(f"Unknown EVAL_ADAPTER: {eval_adapter_name!r}. Use 'mock' or 'anthropic'.")

    triage_adapter = _TriageMockAdapter() if eval_adapter_name == "mock" else real_adapter

    comp_outputs: list[AgentOutput] = []
    triage_outputs: list[AgentOutput] = []

    for case in cases:
        if eval_adapter_name == "mock":
            comp_adapter: ModelAdapter = (
                _CompAmbiguousAdapter() if case.should_abstain else _CompGroundedAdapter()
            )
        else:
            comp_adapter = real_adapter  # type: ignore[assignment]

        comp_out, triage_out = await _invoke_case(case, comp_adapter, triage_adapter)
        comp_outputs.append(comp_out)
        triage_outputs.append(triage_out)
        logger.debug("eval case=%s abstained=%s queue=%s", case.case_id, comp_out.abstained,
                     triage_out.result.get("suggested_queue") if triage_out.result else None)

    return comp_outputs, triage_outputs, cases


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    eval_adapter_name = os.environ.get("EVAL_ADAPTER", "mock")
    eval_model = os.environ.get("EVAL_MODEL") or None

    comp_outputs, triage_outputs, cases = asyncio.run(_run_all(eval_adapter_name, eval_model))

    comp_metrics = compute_completeness_metrics(comp_outputs, cases)
    triage_metrics = compute_triage_metrics(triage_outputs, cases)
    guardrail_metrics = compute_guardrail_metrics()
    all_metrics = {**comp_metrics, **triage_metrics, **guardrail_metrics}

    loader = SyntheticDatasetLoader()
    generate_report(
        metrics=all_metrics,
        cases=cases,
        comp_outputs=comp_outputs,
        triage_outputs=triage_outputs,
        adapter=eval_adapter_name,
        model=eval_model,
        dataset_version=loader.version,
    )

    all_passed = all(v["passed"] for v in all_metrics.values())
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7.4: Run tests to confirm they pass**

The test imports `report.generate_report` which doesn't exist yet — run only the runner unit tests:

```bash
cd services/agent-layer && uv run pytest evals/test_runner.py -v 2>&1 | head -30
```

If you see `ModuleNotFoundError: No module named 'evals.report'`, create a stub first:

Create `services/agent-layer/evals/report.py` (temporary stub only):

```python
def generate_report(**kwargs):
    return {}
```

Then run:

```bash
cd services/agent-layer && uv run pytest evals/test_runner.py -v
```
Expected: `5 passed`

- [ ] **Step 7.5: Commit (stub report will be replaced in Task 8)**

```bash
git add services/agent-layer/evals/runner.py services/agent-layer/evals/report.py services/agent-layer/evals/test_runner.py
git commit -m "feat(evals): runner with mock adapters — _CompGrounded, _CompAmbiguous, _TriageMock"
```

---

### Task 8: Report module + results baseline

**Files:**
- Modify: `services/agent-layer/evals/report.py` (replace stub with full implementation)
- Create: `services/agent-layer/evals/results/.gitignore`
- Create: `services/agent-layer/evals/results/latest.json`
- Create: `services/agent-layer/evals/results/latest.md`

- [ ] **Step 8.1: Write the failing tests**

Append to `services/agent-layer/evals/test_runner.py`:

```python
import json
import os
from pathlib import Path
from uuid import uuid4

from enstellar_agents.models import AgentOutput
from evals.dataset.base import EvalCase
from evals.report import generate_report


def _make_report_inputs():
    cases = [EvalCase(
        case_id="syn-001", lob="commercial", urgency="standard",
        procedure_codes=["27447"], diagnosis_codes=["M17.11"],
        doc_requirements=["op_report"], expected_gaps=["op_report"],
        expected_queue="clinical_review", should_abstain=False,
    )]
    comp = [AgentOutput(
        agent_id="completeness-v1", tenant_id="tenant-eval", case_id=uuid4(),
        confidence=0.88, citations=["CriteriaCorp/op_report/v2024"], abstained=False,
        result={"gaps": [{"required_document_type": "op_report", "citation": "CriteriaCorp/op_report/v2024"}]},
        provenance={"model_name": "eval-mock", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    triage = [AgentOutput(
        agent_id="triage-v1", tenant_id="tenant-eval", case_id=uuid4(),
        confidence=0.88, citations=["RoutingPolicy/urgency/standard"], abstained=False,
        result={"suggested_queue": "clinical_review"},
        provenance={"model_name": "eval-mock", "timestamp": "2026-06-09T00:00:00Z"},
    )]
    return cases, comp, triage


def test_generate_report_produces_json_file(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {
        "groundedness": {"score": 1.0, "threshold": 0.80, "passed": True},
        "precision": {"score": 1.0, "threshold": 0.75, "passed": True},
        "recall": {"score": 1.0, "threshold": 0.70, "passed": True},
        "abstention_accuracy": {"score": 1.0, "threshold": 0.85, "passed": True},
        "routing_accuracy": {"score": 1.0, "threshold": 0.80, "passed": True},
        "guardrail_block_rate": {"score": 1.0, "threshold": 0.90, "passed": True},
        "guardrail_fp_rate": {"score": 0.0, "threshold": 0.05, "passed": True},
    }
    report = generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    assert report["passed"] is True
    latest = json.loads((tmp_path / "latest.json").read_text())
    assert latest["adapter"] == "mock"
    assert "metrics" in latest
    assert "cases" in latest


def test_generate_report_produces_markdown_file(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {
        "groundedness": {"score": 0.87, "threshold": 0.80, "passed": True},
        "precision": {"score": 0.79, "threshold": 0.75, "passed": True},
        "recall": {"score": 0.72, "threshold": 0.70, "passed": True},
        "abstention_accuracy": {"score": 0.88, "threshold": 0.85, "passed": True},
        "routing_accuracy": {"score": 0.83, "threshold": 0.80, "passed": True},
        "guardrail_block_rate": {"score": 0.95, "threshold": 0.90, "passed": True},
        "guardrail_fp_rate": {"score": 0.02, "threshold": 0.05, "passed": True},
    }
    generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    md = (tmp_path / "latest.md").read_text()
    assert "## Agent Eval Results" in md
    assert "Groundedness" in md
    assert "PASSED (7/7)" in md


def test_generate_report_delta_is_none_when_no_baseline(tmp_path, monkeypatch):
    import evals.report as report_mod
    monkeypatch.setattr(report_mod, "RESULTS_DIR", tmp_path)
    cases, comp, triage = _make_report_inputs()
    metrics = {"groundedness": {"score": 0.85, "threshold": 0.80, "passed": True},
               "precision": {"score": 0.80, "threshold": 0.75, "passed": True},
               "recall": {"score": 0.72, "threshold": 0.70, "passed": True},
               "abstention_accuracy": {"score": 0.90, "threshold": 0.85, "passed": True},
               "routing_accuracy": {"score": 0.85, "threshold": 0.80, "passed": True},
               "guardrail_block_rate": {"score": 1.0, "threshold": 0.90, "passed": True},
               "guardrail_fp_rate": {"score": 0.0, "threshold": 0.05, "passed": True}}
    report = generate_report(
        metrics=metrics, cases=cases, comp_outputs=comp, triage_outputs=triage,
        adapter="mock", model=None, dataset_version="synthetic-v1",
    )
    assert report["metrics"]["groundedness"]["delta"] is None
```

- [ ] **Step 8.2: Run tests to confirm they fail**

```bash
cd services/agent-layer && uv run pytest evals/test_runner.py -k "report" -v 2>&1 | head -20
```
Expected: tests fail because `report.py` is just a stub returning `{}`.

- [ ] **Step 8.3: Implement report.py**

Replace `services/agent-layer/evals/report.py` with:

```python
"""Eval report generator — writes JSON and markdown output with run-over-run deltas."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from enstellar_agents.models import AgentOutput

from evals.dataset.base import EvalCase

logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).parent / "results"

_METRIC_LABELS = {
    "groundedness": "Groundedness",
    "precision": "Precision",
    "recall": "Recall",
    "abstention_accuracy": "Abstention accuracy",
    "routing_accuracy": "Routing accuracy",
    "guardrail_block_rate": "Guardrail block rate",
    "guardrail_fp_rate": "Guardrail FP rate",
}
_THRESHOLD_DISPLAY = {
    "groundedness": "≥ 0.80",
    "precision": "≥ 0.75",
    "recall": "≥ 0.70",
    "abstention_accuracy": "≥ 0.85",
    "routing_accuracy": "≥ 0.80",
    "guardrail_block_rate": "≥ 0.90",
    "guardrail_fp_rate": "≤ 0.05",
}


def _load_baseline() -> dict | None:
    baseline_path = RESULTS_DIR / "latest.json"
    if not baseline_path.exists():
        return None
    try:
        with open(baseline_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _build_case_records(
    cases: list[EvalCase],
    comp_outputs: list[AgentOutput],
    triage_outputs: list[AgentOutput],
) -> list[dict]:
    records = []
    for case, comp_out, triage_out in zip(cases, comp_outputs, triage_outputs):
        gaps_detected = []
        if not comp_out.abstained and comp_out.result:
            gaps_detected = [
                g.get("required_document_type", "")
                for g in comp_out.result.get("gaps", [])
            ]
        predicted_queue = None
        if not triage_out.abstained and triage_out.result:
            predicted_queue = triage_out.result.get("suggested_queue")
        records.append({
            "case_id": case.case_id,
            "gaps_detected": gaps_detected,
            "gaps_expected": case.expected_gaps,
            "queue_predicted": predicted_queue,
            "queue_expected": case.expected_queue,
            "abstained": comp_out.abstained,
            "citations": comp_out.citations,
        })
    return records


def _build_markdown(report: dict, metrics: dict) -> str:
    run_id = report["run_id"]
    adapter = report["adapter"]
    model = report["model"]
    dataset_version = report["dataset_version"]
    all_passed = report["passed"]

    lines = [
        f"## Agent Eval Results — {run_id}",
        f"Adapter: {adapter} | Model: {model} | Dataset: {dataset_version}",
        "",
        "| Metric | Score | Threshold | Δ | Status |",
        "|--------|-------|-----------|---|--------|",
    ]
    for key, val in metrics.items():
        label = _METRIC_LABELS.get(key, key)
        score = f"{val['score']:.2f}"
        threshold = _THRESHOLD_DISPLAY.get(key, str(val["threshold"]))
        delta = f"{val['delta']:+.2f}" if val.get("delta") is not None else "—"
        status = "✅" if val["passed"] else "❌"
        lines.append(f"| {label} | {score} | {threshold} | {delta} | {status} |")

    passed_count = sum(1 for v in metrics.values() if v["passed"])
    total_count = len(metrics)
    overall = "PASSED" if all_passed else "FAILED"
    lines.extend(["", f"Overall: {overall} ({passed_count}/{total_count})", ""])
    return "\n".join(lines)


def generate_report(
    *,
    metrics: dict,
    cases: list[EvalCase],
    comp_outputs: list[AgentOutput],
    triage_outputs: list[AgentOutput],
    adapter: str,
    model: str | None,
    dataset_version: str,
) -> dict:
    """Write eval-{timestamp}.json, latest.json, and latest.md; return the report dict."""
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    baseline = _load_baseline()

    metrics_with_delta: dict[str, dict] = {}
    for key, val in metrics.items():
        delta = None
        if baseline and "metrics" in baseline and key in baseline["metrics"]:
            delta = round(val["score"] - baseline["metrics"][key]["score"], 4)
        metrics_with_delta[key] = {**val, "delta": delta}

    all_passed = all(v["passed"] for v in metrics.values())
    report = {
        "run_id": run_id,
        "adapter": adapter,
        "model": model or "default",
        "dataset_version": dataset_version,
        "passed": all_passed,
        "metrics": metrics_with_delta,
        "cases": _build_case_records(cases, comp_outputs, triage_outputs),
    }

    RESULTS_DIR.mkdir(exist_ok=True)

    ts = run_id.replace(":", "").replace("T", "-").rstrip("Z")
    with open(RESULTS_DIR / f"eval-{ts}.json", "w") as f:
        json.dump(report, f, indent=2)
    with open(RESULTS_DIR / "latest.json", "w") as f:
        json.dump(report, f, indent=2)

    md = _build_markdown(report, metrics_with_delta)
    with open(RESULTS_DIR / "latest.md", "w") as f:
        f.write(md)

    passed_count = sum(1 for v in metrics.values() if v["passed"])
    total_count = len(metrics)
    status_str = "PASSED" if all_passed else "FAILED"
    logger.info("Eval %s (%d/%d metrics passed)", status_str, passed_count, total_count)
    for key, val in metrics_with_delta.items():
        status = "PASS" if val["passed"] else "FAIL"
        delta_str = f"  Δ{val['delta']:+.4f}" if val["delta"] is not None else ""
        logger.info(
            "  %-24s %.4f (threshold %s)%s [%s]",
            _METRIC_LABELS.get(key, key), val["score"],
            _THRESHOLD_DISPLAY.get(key, str(val["threshold"])), delta_str, status,
        )

    return report
```

- [ ] **Step 8.4: Create results directory files**

Create `services/agent-layer/evals/results/.gitignore`:

```
*
!.gitignore
!latest.json
!latest.md
```

Create `services/agent-layer/evals/results/latest.json`:

```json
{}
```

Create `services/agent-layer/evals/results/latest.md`:

```
## Agent Eval Results — (no runs yet)
Adapter: — | Model: — | Dataset: —
```

- [ ] **Step 8.5: Run all eval tests to confirm they pass**

```bash
cd services/agent-layer && uv run pytest evals/ -v
```
Expected: all tests pass (including the unchanged `test_completeness_eval.py`).

- [ ] **Step 8.6: Commit**

```bash
git add services/agent-layer/evals/report.py \
        services/agent-layer/evals/results/.gitignore \
        services/agent-layer/evals/results/latest.json \
        services/agent-layer/evals/results/latest.md \
        services/agent-layer/evals/test_runner.py
git commit -m "feat(evals): report module — JSON + markdown output with run-over-run deltas"
```

---

### Task 9: `make eval` targets + GitHub Actions CI

**Files:**
- Modify: `Makefile` — add `eval` and `eval-real` targets, update `.PHONY`
- Create: `.github/workflows/eval.yml`

- [ ] **Step 9.1: Confirm `make test-agents` still passes before touching Makefile**

```bash
cd services/agent-layer && uv run pytest -v 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 9.2: Add eval targets to Makefile**

Open `Makefile`. Find the line:

```makefile
## Run agent-layer tests only.
test-agents:
	cd services/agent-layer && uv run pytest -v
```

Insert the following BEFORE that block (so the eval targets are grouped near the agent-layer targets):

```makefile
## Run agent evals (mock adapter by default; fast, no API cost).
## Use EVAL_ADAPTER=anthropic ANTHROPIC_API_KEY=<key> for real model signal.
eval:
	uv run --project services/agent-layer python -m evals.runner

## Run evals against real Claude API (requires ANTHROPIC_API_KEY env var).
eval-real:
	EVAL_ADAPTER=anthropic uv run --project services/agent-layer python -m evals.runner

```

- [ ] **Step 9.3: Update .PHONY**

The `.PHONY` line is at the top of the Makefile. Find it and add `eval eval-real`:

Old `.PHONY` ends with:
```makefile
.PHONY: up down test test-workflow test-connectors test-agents ...
```

Add `eval eval-real` to the end of the existing `.PHONY` list. The exact edit: find `test-agents` in `.PHONY` and ensure `eval eval-real` appear on the same line (the Makefile has one very long `.PHONY` line).

- [ ] **Step 9.4: Verify eval target**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar && make eval 2>&1 | tail -15
```
Expected: output ends with `Eval PASSED (7/7 metrics passed)` and exit code 0.

If the command fails with exit code 1 (a metric is below threshold), re-check the mock adapters in `runner.py` against the threshold table in the spec.

- [ ] **Step 9.5: Create GitHub Actions workflow**

Create `.github/workflows/eval.yml`:

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
      - name: Commit latest results (real adapter only)
        if: inputs.adapter == 'anthropic'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add services/agent-layer/evals/results/latest.md \
                  services/agent-layer/evals/results/latest.json
          git diff --staged --quiet || git commit -m "eval: update latest results [skip ci]"
          git push
```

- [ ] **Step 9.6: Run the full agent-layer test suite to confirm nothing regressed**

```bash
cd services/agent-layer && uv run pytest -v 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 9.7: Commit**

```bash
git add Makefile .github/workflows/eval.yml
git commit -m "feat(evals): make eval + eval-real targets; workflow_dispatch CI job"
```

---

## Final Verification

After all tasks complete, run the full sequence:

```bash
# 1. All agent-layer tests still pass
cd services/agent-layer && uv run pytest -v

# 2. make eval exits 0
cd /path/to/Enstellar && make eval

# 3. latest.md was written
cat services/agent-layer/evals/results/latest.md

# 4. Confirm test_completeness_eval.py is unchanged
git diff HEAD~9 services/agent-layer/evals/test_completeness_eval.py
# Expected: (empty — no diff)

# 5. Confirm guardrails/engine.py and rules.py are unchanged
git diff HEAD~9 services/agent-layer/enstellar_agents/guardrails/
# Expected: (empty — no diff)
```

---

## Definition of Done (from spec)

- `make eval` exits 0 with mock adapter; all 7 metrics computed and logged.
- `make eval-real` exits 0 with `EVAL_ADAPTER=anthropic`; `latest.md` updated.
- `evals/results/latest.md` committed and human-readable.
- `workflow_dispatch` trigger present in `.github/workflows/eval.yml`; results uploaded as artifact.
- PHI boundary enforced: no member/provider identifiers in eval cases or log lines.
- `guardrails/engine.py` and `guardrails/rules.py` untouched; `test_completeness_eval.py` untouched.
