import pytest
from src.metrics.extraction_pr import compute_extraction_pr
from src.metrics.citation_validity import compute_citation_validity_pct
from src.metrics.groundedness import compute_groundedness_score
from src.metrics.calibration_ece import compute_calibration_ece


def test_extraction_pr_perfect_match():
    gold = [{"resource_type": "Procedure", "normalization": {"code": "97110"}}]
    pred = [{"resource_type": "Procedure", "normalization": {"code": "97110"}}]
    m = compute_extraction_pr(pred, gold)
    assert m.f1 == pytest.approx(1.0)


def test_extraction_pr_zero_recall():
    gold = [{"resource_type": "Procedure", "normalization": {"code": "97110"}}]
    m = compute_extraction_pr([], gold)
    assert m.recall == 0.0
    assert m.f1 == 0.0


def test_citation_validity_all_cited():
    assertions = [{"id": "a1", "citations": [{"document_ref": "d1"}]}]
    assert compute_citation_validity_pct(assertions) == pytest.approx(1.0)


def test_citation_validity_some_uncited():
    assertions = [
        {"id": "a1", "citations": [{"document_ref": "d1"}]},
        {"id": "a2", "citations": []},
    ]
    assert compute_citation_validity_pct(assertions) == pytest.approx(0.5)


def test_groundedness_resolves_valid_spans():
    assertions = [{"citations": [{"document_ref": "d1", "page": 1}]}]
    spans = {"d1": [{"page": 1, "text": "content"}]}
    score = compute_groundedness_score(assertions, spans)
    assert score == pytest.approx(1.0)


def test_groundedness_unresolvable_span():
    assertions = [{"citations": [{"document_ref": "d1", "page": 99}]}]
    spans = {"d1": [{"page": 1, "text": "content"}]}
    score = compute_groundedness_score(assertions, spans)
    assert score == pytest.approx(0.0)


def test_calibration_ece_perfect():
    # conf==1.0 with True → bin_conf=1.0, bin_acc=1.0 → ECE contribution 0.0
    # conf==0.0 with False → bin_conf=0.0, bin_acc=0.0 → ECE contribution 0.0
    pairs = [(1.0, True), (0.0, False)]
    ece = compute_calibration_ece(pairs)
    assert ece == pytest.approx(0.0)


def test_extraction_pr_empty_gold():
    pred = [{"resource_type": "Procedure", "normalization": {"code": "97110"}}]
    m = compute_extraction_pr(pred, gold=[])
    assert m.recall == 0.0
    assert m.f1 == 0.0


def test_citation_validity_empty_assertions():
    assert compute_citation_validity_pct([]) == pytest.approx(1.0)


def test_groundedness_empty_assertions():
    score = compute_groundedness_score([], {})
    assert score == pytest.approx(1.0)


def test_calibration_ece_empty_pairs():
    ece = compute_calibration_ece([])
    assert ece == pytest.approx(0.0)
