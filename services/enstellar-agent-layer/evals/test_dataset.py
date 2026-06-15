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
