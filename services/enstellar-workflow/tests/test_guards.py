"""Unit tests for the adverse-transition guard — no DB, no network."""
import pytest

from enstellar_workflow.engine.guards import (
    ADVERSE_STATES,
    GuardError,
    GuardResult,
    adverse_transition_guard,
)


def test_adverse_guard_blocks_denied_without_signoff():
    result = adverse_transition_guard("denied", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None
    assert "human sign-off" in result.reason


def test_adverse_guard_blocks_partially_denied_without_signoff():
    result = adverse_transition_guard("partially_denied", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None


def test_adverse_guard_blocks_adverse_modification_without_signoff():
    result = adverse_transition_guard("adverse_modification", human_signoff_recorded=False)
    assert result.passed is False
    assert result.reason is not None


def test_adverse_guard_allows_denied_with_signoff():
    result = adverse_transition_guard("denied", human_signoff_recorded=True)
    assert result.passed is True
    assert result.reason is None


def test_adverse_guard_allows_partially_denied_with_signoff():
    result = adverse_transition_guard("partially_denied", human_signoff_recorded=True)
    assert result.passed is True


def test_adverse_guard_allows_adverse_modification_with_signoff():
    result = adverse_transition_guard("adverse_modification", human_signoff_recorded=True)
    assert result.passed is True


@pytest.mark.parametrize(
    "state",
    [
        "intake",
        "completeness_check",
        "auto_determination",
        "clinical_review",
        "pend_rfi",
        "approved",
        "withdrawn",
        "closed",
    ],
)
def test_adverse_guard_allows_non_adverse_states_without_signoff(state: str):
    result = adverse_transition_guard(state, human_signoff_recorded=False)
    assert result.passed is True, f"Expected pass for non-adverse state {state!r}"


def test_adverse_states_set_contains_exactly_three_states():
    assert ADVERSE_STATES == frozenset({"denied", "partially_denied", "adverse_modification"})


def test_guard_result_is_named_tuple():
    result = GuardResult(passed=True, reason=None)
    assert result.passed is True
    assert result.reason is None


def test_guard_error_carries_reason():
    err = GuardError("test reason")
    assert err.reason == "test reason"
    assert str(err) == "test reason"


# ============================================================
# Task 4 — S6b: sign-off gate on appeal_upheld (continued adverse)
# appeal_upheld is in SIGNOFF_REQUIRED_STATES but NOT in ADVERSE_STATES.
# ============================================================


def test_adverse_guard_blocks_appeal_upheld_without_signoff():
    """appeal_upheld (continued adverse) requires sign-off — must be blocked without it."""
    result = adverse_transition_guard("appeal_upheld", human_signoff_recorded=False)
    assert result.passed is False, (
        "INVARIANT VIOLATED: appeal_upheld without sign-off must be blocked"
    )
    assert result.reason is not None


def test_adverse_guard_allows_appeal_upheld_with_signoff():
    """appeal_upheld WITH sign-off is the legitimate AppealService uphold path — must pass."""
    result = adverse_transition_guard("appeal_upheld", human_signoff_recorded=True)
    assert result.passed is True
    assert result.reason is None


def test_appeal_upheld_not_in_adverse_states():
    """appeal_upheld MUST NOT be added to ADVERSE_STATES — that would re-introduce a
    DECISION_RECORDED for appeals and break the S6a no-double-fire invariant."""
    assert "appeal_upheld" not in ADVERSE_STATES, (
        "S6a INVARIANT VIOLATED: appeal_upheld must not be in ADVERSE_STATES"
    )
