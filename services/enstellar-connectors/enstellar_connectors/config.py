"""ConnectorSettings — reads from env variables with DIGICORE_ prefix.

All Digicore-specific settings live here. Settings are loaded once and
cached in a module-level singleton. Tests that change env vars must call
reset_settings() to clear the cache, or use the conftest autouse fixture.
"""
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConnectorSettings(BaseSettings):
    """All settings for integration-connectors.

    Environment variable prefix: DIGICORE_
    Example: DIGICORE_BASE_URL=http://digicore-runtime:8083

    Pydantic-settings converts env var names to lowercase field names
    after stripping the prefix. DIGICORE_BASE_URL → base_url.
    """

    model_config = SettingsConfigDict(
        env_prefix="DIGICORE_",
        case_sensitive=False,
    )

    base_url: str = "http://digicore-runtime:8083"
    """Base URL for the digicore-runtime API. Override with DIGICORE_BASE_URL."""

    circuit_breaker_threshold: int = 5
    """Number of consecutive call failures before the circuit opens."""

    circuit_breaker_recovery_seconds: float = 30.0
    """Seconds to wait before the circuit enters half-open state."""

    request_timeout_seconds: float = 10.0
    """Per-call HTTP timeout in seconds (applied to each retry attempt)."""

    retry_max_attempts: int = 3
    """Total number of attempts per call (1 original + N-1 retries)."""

    # Revital — validation_alias bypasses DIGICORE_ prefix for this field only
    revital_base_url: str = Field(
        default="http://revital-pipeline:3014",
        validation_alias="REVITAL_BASE_URL",
        description="Base URL for the Revital summarization API. Override with REVITAL_BASE_URL.",
    )


_settings: ConnectorSettings | None = None


def get_settings() -> ConnectorSettings:
    """Return the module-level settings singleton. Instantiated on first call."""
    global _settings
    if _settings is None:
        _settings = ConnectorSettings()
    return _settings


def reset_settings() -> None:
    """Clear the cached settings singleton. Used in tests that patch env vars."""
    global _settings
    _settings = None
