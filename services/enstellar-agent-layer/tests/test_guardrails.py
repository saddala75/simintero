"""Tests for guardrail rules and GuardrailEngine.

Each rule has two test cases: a passing case and a failing case.
Tests marked INVARIANT must never be deleted or weakened.
"""
from __future__ import annotations

import pytest
from uuid import uuid4


def _make_output(**overrides):
    """Create a minimal valid AgentOutput for testing."""
    from enstellar_agents.models import AgentOutput

    defaults = {
        "agent_id": "completeness-v1",
        "tenant_id": "tenant-abc",
        "case_id": uuid4(),
        "confidence": 0.85,
        "citations": ["CriteriaCorp SR-2024"],
        "abstained": False,
        "abstention_reason": None,
        "result": {"gaps": [], "rfi_draft": {"body": "Please provide documents."}},
        "provenance": {"model_name": "llama3", "timestamp": "2026-06-06T00:00:00+00:00"},
    }
    defaults.update(overrides)
    return AgentOutput.model_validate(defaults)


# ──────────────────────────────────────────────
# rule_no_autonomous_adverse  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_no_autonomous_adverse_passes_clean_output() -> None:
    from enstellar_agents.guardrails.rules import rule_no_autonomous_adverse

    output = _make_output(result={"gaps": [], "rfi_draft": {"body": "Please provide the missing documents."}})
    assert rule_no_autonomous_adverse(output) is None


@pytest.mark.parametrize("keyword", ["denied", "deny", "denial", "adverse",
                                      "not medically necessary", "experimental", "investigational"])
def test_rule_no_autonomous_adverse_blocks_adverse_keyword(keyword: str) -> None:
    """INVARIANT: Any adverse keyword in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_no_autonomous_adverse

    output = _make_output(result={"text": f"The claim is {keyword}."})
    violation = rule_no_autonomous_adverse(output)
    assert violation is not None
    assert "no_autonomous_adverse" in violation


# ──────────────────────────────────────────────
# rule_citations_required
# ──────────────────────────────────────────────

def test_rule_citations_required_passes_non_abstained_with_citations() -> None:
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=False, citations=["CriteriaCorp SR-2024"])
    assert rule_citations_required(output) is None


def test_rule_citations_required_blocks_non_abstained_no_citations() -> None:
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=False, citations=[])
    violation = rule_citations_required(output)
    assert violation is not None
    assert "citations_required" in violation


def test_rule_citations_required_passes_abstained_with_no_citations() -> None:
    """Abstained outputs are exempt from the citations requirement."""
    from enstellar_agents.guardrails.rules import rule_citations_required

    output = _make_output(abstained=True, citations=[], result=None)
    assert rule_citations_required(output) is None


# ──────────────────────────────────────────────
# rule_confidence_threshold
# ──────────────────────────────────────────────

def test_rule_confidence_threshold_passes_at_threshold() -> None:
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.7, abstained=False)
    assert rule_confidence_threshold(output) is None


def test_rule_confidence_threshold_blocks_below_threshold() -> None:
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.65, abstained=False)
    violation = rule_confidence_threshold(output)
    assert violation is not None
    assert "confidence_threshold" in violation


def test_rule_confidence_threshold_passes_abstained_low_confidence() -> None:
    """Abstained outputs are exempt — low confidence + abstained=True is correct behaviour."""
    from enstellar_agents.guardrails.rules import rule_confidence_threshold

    output = _make_output(confidence=0.2, abstained=True, result=None)
    assert rule_confidence_threshold(output) is None


# ──────────────────────────────────────────────
# rule_schema_validity
# ──────────────────────────────────────────────

def test_rule_schema_validity_passes_valid_output() -> None:
    from enstellar_agents.guardrails.rules import rule_schema_validity

    output = _make_output()
    assert rule_schema_validity(output) is None


# ──────────────────────────────────────────────
# rule_tenant_isolation  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_tenant_isolation_passes_matching_tenant() -> None:
    from enstellar_agents.guardrails.rules import rule_tenant_isolation

    output = _make_output(tenant_id="tenant-abc")
    assert rule_tenant_isolation(output, "tenant-abc") is None


def test_rule_tenant_isolation_blocks_mismatched_tenant() -> None:
    """INVARIANT: Cross-tenant output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_tenant_isolation

    output = _make_output(tenant_id="tenant-abc")
    violation = rule_tenant_isolation(output, "tenant-xyz")
    assert violation is not None
    assert "tenant_isolation" in violation


# ──────────────────────────────────────────────
# rule_phi_minimization  [INVARIANT]
# ──────────────────────────────────────────────

def test_rule_phi_minimization_passes_clean_output() -> None:
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"gaps": [], "notes": "procedure code 27447"})
    assert rule_phi_minimization(output) is None


def test_rule_phi_minimization_blocks_ssn_pattern() -> None:
    """INVARIANT: SSN-like pattern in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"text": "Member SSN: 123-45-6789"})
    violation = rule_phi_minimization(output)
    assert violation is not None
    assert "phi_minimization" in violation


def test_rule_phi_minimization_blocks_probable_dob() -> None:
    """INVARIANT: DOB pattern in output must be blocked. Never remove this test."""
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"text": "Member dob: 1980-04-15"})
    violation = rule_phi_minimization(output)
    assert violation is not None
    assert "phi_minimization" in violation


# ──────────────────────────────────────────────
# rule_abstention_on_low_confidence
# ──────────────────────────────────────────────

def test_rule_abstention_passes_high_confidence_not_abstained() -> None:
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.85, abstained=False)
    assert rule_abstention_on_low_confidence(output) is None


def test_rule_abstention_blocks_low_confidence_not_abstained() -> None:
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.35, abstained=False)
    violation = rule_abstention_on_low_confidence(output)
    assert violation is not None
    assert "abstention_required" in violation


def test_rule_abstention_passes_low_confidence_already_abstained() -> None:
    """Low confidence + abstained=True is the correct outcome; rule must not re-fire."""
    from enstellar_agents.guardrails.rules import rule_abstention_on_low_confidence

    output = _make_output(confidence=0.1, abstained=True, result=None)
    assert rule_abstention_on_low_confidence(output) is None


def test_rule_no_autonomous_adverse_blocks_keyword_in_abstention_reason() -> None:
    """INVARIANT: Adverse keyword in abstention_reason must also be blocked."""
    from enstellar_agents.guardrails.rules import rule_no_autonomous_adverse

    output = _make_output(abstained=True, result=None, abstention_reason="Service was denied by review.")
    violation = rule_no_autonomous_adverse(output)
    assert violation is not None
    assert "no_autonomous_adverse" in violation


def test_rule_phi_minimization_blocks_dob_phrase() -> None:
    """INVARIANT: 'date of birth' pattern must be blocked, not just 'dob'."""
    from enstellar_agents.guardrails.rules import rule_phi_minimization

    output = _make_output(result={"text": "Date of Birth: 1980-04-15"})
    violation = rule_phi_minimization(output)
    assert violation is not None
    assert "phi_minimization" in violation


# ──────────────────────────────────────────────
# GuardrailEngine integration tests
# ──────────────────────────────────────────────

def test_engine_passes_clean_output() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        tenant_id="tenant-abc",
        confidence=0.85,
        citations=["CriteriaCorp SR-2024"],
        abstained=False,
        result={"gaps": [], "rfi_draft": {"body": "Please provide the operative report."}},
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is True
    assert result.violations == []


def test_engine_blocks_adverse_keyword() -> None:
    """INVARIANT: GuardrailEngine must block adverse language. Never remove this test."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        result={"gaps": [], "rfi_draft": {"body": "The claim is denied."}},
        citations=["CriteriaCorp SR-2024"],
        confidence=0.85,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("no_autonomous_adverse" in v for v in result.violations)


def test_engine_blocks_missing_citations() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(citations=[], abstained=False, confidence=0.85)
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("citations_required" in v for v in result.violations)


def test_engine_blocks_low_confidence_non_abstained() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    # confidence=0.65 is below the 0.7 threshold but above the 0.4 abstention threshold
    output = _make_output(confidence=0.65, abstained=False, citations=["SR-2024"])
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("confidence_threshold" in v for v in result.violations)


def test_engine_collects_multiple_violations() -> None:
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        confidence=0.65,
        citations=[],   # triggers citations_required AND confidence_threshold
        abstained=False,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert len(result.violations) >= 2


def test_engine_passes_abstained_output_with_no_citations() -> None:
    """Abstained outputs are always advisory-safe: citations and confidence checks are skipped."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(
        abstained=True,
        abstention_reason="low confidence",
        result=None,
        citations=[],
        confidence=0.1,
    )
    result = GuardrailEngine().check(output, "tenant-abc")
    # abstained output with no adverse content, correct tenant → must pass
    assert result.passed is True


def test_engine_blocks_tenant_mismatch() -> None:
    """INVARIANT: GuardrailEngine must block cross-tenant output. Never remove this test."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(tenant_id="tenant-xyz")
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("tenant_isolation" in v for v in result.violations)


def test_engine_blocks_phi_ssn_violation() -> None:
    """INVARIANT: GuardrailEngine must block SSN-like patterns in output. Never remove this test."""
    from enstellar_agents.guardrails.engine import GuardrailEngine

    output = _make_output(result={"text": "Member SSN: 123-45-6789"})
    result = GuardrailEngine().check(output, "tenant-abc")
    assert result.passed is False
    assert any("phi_minimization" in v for v in result.violations)
