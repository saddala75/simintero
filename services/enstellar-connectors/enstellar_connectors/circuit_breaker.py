"""In-memory circuit breaker shared by all integration connector clients.

Used by DigiCoreClient, RevitalClient, and any future connector to prevent
repeated calls to a failing downstream service.

State transitions:
  CLOSED    → (failure_threshold consecutive failures) → OPEN
  OPEN      → (recovery_timeout elapsed)               → HALF-OPEN (one probe)
  HALF-OPEN → (probe succeeds)                         → CLOSED
  HALF-OPEN → (probe fails)                            → OPEN

Thread-safety: not thread-safe. All clients are intended for use within
a single asyncio event loop; no locking is required.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open and no call should be attempted."""


class CircuitBreaker:
    """Simple in-memory circuit breaker."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> None:
        self._threshold = failure_threshold
        self._recovery = recovery_timeout
        self._failures = 0
        self._open_at: float | None = None

    def is_open(self) -> bool:
        """Return True if new calls should be blocked."""
        if self._open_at is None:
            return False
        elapsed = time.monotonic() - self._open_at
        if elapsed >= self._recovery:
            # Recovery window elapsed → enter half-open; allow one probe
            self._open_at = None
            logger.info("circuit_breaker=half_open recovery_elapsed=%.1fs", elapsed)
            return False
        return True

    def record_success(self) -> None:
        """Record a successful call. Resets the failure counter and closes the circuit."""
        if self._failures > 0 or self._open_at is not None:
            logger.info("circuit_breaker=closed was_failures=%d", self._failures)
        self._failures = 0
        self._open_at = None

    def record_failure(self) -> None:
        """Record a call failure. Opens the circuit if the threshold is reached."""
        self._failures += 1
        logger.warning(
            "circuit_breaker failure_count=%d threshold=%d",
            self._failures,
            self._threshold,
        )
        if self._failures >= self._threshold:
            self._open_at = time.monotonic()
            logger.error(
                "circuit_breaker=open failures=%d threshold=%d",
                self._failures,
                self._threshold,
            )

    @property
    def failure_count(self) -> int:
        """Current consecutive failure count (for testing/observability)."""
        return self._failures
