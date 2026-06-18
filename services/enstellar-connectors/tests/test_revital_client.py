"""CircuitBreaker pure-logic unit tests (no HTTP, no network).

RevitalClient HTTP behavior (submit / get_analysis, retry, circuit-breaker
integration) is covered in test_client_c2.py against the real C-2 poll API.
"""
from __future__ import annotations

from unittest.mock import patch

from enstellar_connectors.circuit_breaker import CircuitBreaker


def test_cb_starts_closed():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    assert cb.is_open() is False


def test_cb_opens_after_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    assert cb.is_open() is True


def test_cb_does_not_open_before_threshold():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(4):
        cb.record_failure()
    assert cb.is_open() is False


def test_cb_success_resets_failure_count():
    cb = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
    for _ in range(5):
        cb.record_failure()
    cb.record_success()
    assert cb.is_open() is False
    assert cb.failure_count == 0


def test_cb_half_open_after_recovery_timeout():
    """After recovery_timeout elapses, is_open() returns False (half-open probe allowed)."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=5.0)
    for _ in range(3):
        cb.record_failure()
    assert cb.is_open() is True

    with patch("enstellar_connectors.circuit_breaker.time") as mock_time:
        mock_time.monotonic.return_value = cb._open_at + 6.0  # 6 s > 5 s recovery
        assert cb.is_open() is False


def test_cb_failure_count_resets_on_success():
    cb = CircuitBreaker(failure_threshold=5)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    assert cb.failure_count == 0
