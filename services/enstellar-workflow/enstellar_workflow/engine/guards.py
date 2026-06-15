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
    """INVARIANT #1: Any transition to denied/partially_denied/adverse_modification
    requires human_signoff_recorded=True. This guard is NOT configurable away.

    Args:
        to_state: The target state string (e.g. "denied").
        human_signoff_recorded: True only if a clinician/reviewer has explicitly
            recorded sign-off on this determination.

    Returns:
        GuardResult(passed=True, reason=None) if the transition is allowed.
        GuardResult(passed=False, reason=<message>) if blocked.
    """
    if to_state in ADVERSE_STATES and not human_signoff_recorded:
        return GuardResult(
            passed=False,
            reason=(
                f"transition to {to_state!r} requires human sign-off — invariant #1"
            ),
        )
    return GuardResult(passed=True, reason=None)
