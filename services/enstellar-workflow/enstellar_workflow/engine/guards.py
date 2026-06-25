"""Guard functions for state machine transitions.

INVARIANT #1: No code path may produce a denial/adverse determination without
a recorded human (clinician) sign-off. The adverse_transition_guard encodes this
invariant directly and is NOT configurable away.
"""
from __future__ import annotations

from typing import NamedTuple

ADVERSE_STATES: frozenset[str] = frozenset(
    {"denied", "partially_denied", "adverse_modification"}
)

# Every determination outcome — a human approval plus all adverse outcomes.
# A DECISION_RECORDED event (the regulatory-notice trigger) fires on any
# transition into one of these states.
DETERMINATION_STATES: frozenset[str] = frozenset({"approved"}) | ADVERSE_STATES

# States that require human sign-off before they may be entered.
# Extends ADVERSE_STATES with appeal_upheld (a continued adverse determination
# on an appeal — the uphold sign-off gate in AppealService already validated it,
# but the guard enforces it engine-wide so the generic /transitions route cannot
# bypass the requirement).
# NOTE: appeal_upheld is intentionally NOT added to ADVERSE_STATES or
# DETERMINATION_STATES — doing so would fire DECISION_RECORDED for appeals and
# break the S6a no-double-fire invariant.
SIGNOFF_REQUIRED_STATES: frozenset[str] = ADVERSE_STATES | frozenset({"appeal_upheld"})


class GuardResult(NamedTuple):
    passed: bool
    reason: str | None


class GuardError(Exception):
    """Raised by TransitionEngine when a guard rejects a transition."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def adverse_transition_guard(
    to_state: str, human_signoff_recorded: bool
) -> GuardResult:
    """INVARIANT #1: Any transition to an adverse state or appeal_upheld requires
    human_signoff_recorded=True. This guard is NOT configurable away.

    Covered states (SIGNOFF_REQUIRED_STATES):
      * denied, partially_denied, adverse_modification — original adverse states.
      * appeal_upheld — a continued adverse determination on an appeal.

    ADVERSE_STATES and DETERMINATION_STATES are NOT modified so that appeal_upheld
    never triggers DECISION_RECORDED (the S6a no-double-fire invariant).

    Args:
        to_state: The target state string (e.g. "denied", "appeal_upheld").
        human_signoff_recorded: True only if a clinician/reviewer has explicitly
            recorded sign-off on this determination.

    Returns:
        GuardResult(passed=True, reason=None) if the transition is allowed.
        GuardResult(passed=False, reason=<message>) if blocked.
    """
    if to_state in SIGNOFF_REQUIRED_STATES and not human_signoff_recorded:
        return GuardResult(
            passed=False,
            reason=(
                f"transition to {to_state!r} requires human sign-off — invariant #1"
            ),
        )
    return GuardResult(passed=True, reason=None)
