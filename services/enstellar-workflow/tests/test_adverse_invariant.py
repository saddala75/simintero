"""Hypothesis property tests — adverse transition guard exhaustive coverage.

These tests MUST remain in CI. They prove that no combination of
(to_state, human_signoff_recorded) can bypass the adverse-transition
guard defined in enstellar_workflow.engine.guards.

INVARIANT #1: No adverse determination without recorded human sign-off.
Tests here are CI gates — never weaken or skip them.
"""
from __future__ import annotations

import pytest
from hypothesis import given, settings as hyp_settings
from hypothesis import strategies as st

from enstellar_workflow.engine.guards import (
    ADVERSE_STATES,
    GuardResult,
    adverse_transition_guard,
)

NON_ADVERSE_STATES: frozenset[str] = frozenset(
    {
        "intake",
        "completeness_check",
        "auto_determination",
        "clinical_review",
        "pend_rfi",
        "approved",
        "withdrawn",
        "closed",
    }
)


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.just(False),
)
@hyp_settings(max_examples=100)
def test_adverse_guard_always_blocks_without_signoff(to_state: str, human_signoff_recorded: bool):
    """INVARIANT #1: Adverse state + no signoff → guard must block. Always."""
    result = adverse_transition_guard(to_state, human_signoff_recorded)
    assert not result.passed, (
        f"INVARIANT VIOLATION: guard ALLOWED adverse state {to_state!r} "
        f"without human_signoff_recorded — this must never happen."
    )
    assert result.reason is not None
    assert "sign-off" in result.reason


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.just(True),
)
@hyp_settings(max_examples=100)
def test_adverse_guard_always_allows_with_signoff(to_state: str, human_signoff_recorded: bool):
    """With human_signoff_recorded=True, all adverse states must be allowed."""
    result = adverse_transition_guard(to_state, human_signoff_recorded)
    assert result.passed, (
        f"Guard blocked {to_state!r} even with human_signoff_recorded=True — "
        f"this prevents legitimate adverse determinations."
    )


@given(to_state=st.sampled_from(sorted(NON_ADVERSE_STATES)))
@hyp_settings(max_examples=50)
def test_non_adverse_never_requires_signoff(to_state: str):
    """Non-adverse states must never require sign-off — that would break approvals."""
    result = adverse_transition_guard(to_state, human_signoff_recorded=False)
    assert result.passed, (
        f"Guard incorrectly blocked non-adverse state {to_state!r} without signoff."
    )


def test_adverse_states_constant_is_exactly_three():
    """The ADVERSE_STATES constant must contain exactly the three specified states."""
    assert ADVERSE_STATES == frozenset(
        {"denied", "partially_denied", "adverse_modification"}
    ), (
        f"ADVERSE_STATES has changed: {ADVERSE_STATES!r}. "
        "Any change here requires senior engineer sign-off."
    )


@given(
    to_state=st.sampled_from(sorted(ADVERSE_STATES)),
    human_signoff_recorded=st.booleans(),
)
@hyp_settings(max_examples=100)
def test_guard_result_is_deterministic(to_state: str, human_signoff_recorded: bool):
    """Same inputs must always produce the same result — guard is pure."""
    r1 = adverse_transition_guard(to_state, human_signoff_recorded)
    r2 = adverse_transition_guard(to_state, human_signoff_recorded)
    assert r1.passed == r2.passed
    assert r1.reason == r2.reason
