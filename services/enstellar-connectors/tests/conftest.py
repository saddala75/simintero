"""Shared pytest fixtures for enstellar-connectors tests."""
import pytest

from enstellar_connectors.config import reset_settings


@pytest.fixture(autouse=True)
def clear_settings_singleton():
    """Reset the settings singleton before every test.

    Ensures that env-var patches in one test don't leak into the next.
    """
    reset_settings()
    yield
    reset_settings()
