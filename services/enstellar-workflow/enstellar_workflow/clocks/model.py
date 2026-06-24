"""Clock dataclasses and CLOCK_RULES.

CLOCK_RULES encodes UM regulatory minimums:
  - expedited = 72 h = 3 calendar days  (URAC, NCQA, many state regs)
  - standard   = 7 calendar days
  - concurrent = 1 calendar day (concurrent / retrospective review)

DO NOT modify CLOCK_RULES without consulting regulatory requirements for each
line-of-business. These are minimums; specific LOBs or states may be stricter.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

# (urgency, clock_type) -> calendar_days
CLOCK_RULES: dict[tuple[str, str], int] = {
    ("expedited", "decision"): 3,
    ("standard", "decision"): 7,
    ("concurrent", "decision"): 1,
    ("standard", "appeal"): 30,
    ("expedited", "appeal"): 3,
    ("concurrent", "appeal"): 30,
}


@dataclass
class ClockDefinition:
    clock_type: str
    urgency: str
    duration_calendar_days: int

    @classmethod
    def for_case(cls, urgency: str, clock_type: str = "decision") -> "ClockDefinition":
        """Lookup the regulatory duration for (urgency, clock_type).

        Raises ValueError if the combination is not in CLOCK_RULES.
        """
        days = CLOCK_RULES.get((urgency, clock_type))
        if days is None:
            raise ValueError(
                f"No clock rule for urgency={urgency!r}, clock_type={clock_type!r}. "
                f"Available: {list(CLOCK_RULES.keys())}"
            )
        return cls(clock_type=clock_type, urgency=urgency, duration_calendar_days=days)


@dataclass
class ClockState:
    clock_id: str
    tenant_id: str
    case_id: str
    clock_type: str
    state: Literal["running", "paused", "breached", "stopped"]
    deadline: datetime
    paused_at: datetime | None
    total_paused_seconds: float
    breached_at: datetime | None

    @property
    def adjusted_deadline(self) -> datetime:
        """Deadline extended by all pause time (accumulated + any current pause).

        If the clock is currently paused, the in-progress pause duration is
        included so callers can compute the correct effective deadline.
        """
        offset = timedelta(seconds=self.total_paused_seconds)
        if self.paused_at is not None:
            offset += datetime.now(timezone.utc) - self.paused_at
        return self.deadline + offset
