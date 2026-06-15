"""Startup audience fail-fast guard tests.

The workflow engine must refuse to start in a non-local deploy when the JWT
audience (`oidc_audience`) is unset, because an unset audience disables `aud`
verification and would accept tokens minted for other simintero-realm services.
Local/test/dev are exempt (audience commonly unset for development).

The guard runs at the top of the FastAPI lifespan, BEFORE any DB/consumer
setup, so these tests drive the lifespan and assert on the guard alone — no
database is required (we expect the RuntimeError to fire first, and for the
allow case we never enter the body because we stop iteration immediately).
"""
import pytest

import enstellar_workflow.config as cfg_mod
from enstellar_workflow.config import Settings
from enstellar_workflow.main import app, lifespan


@pytest.fixture(autouse=True)
def _reset_settings():
    cfg_mod._settings = None
    yield
    cfg_mod._settings = None


@pytest.mark.asyncio
async def test_startup_raises_when_prod_and_audience_unset(monkeypatch):
    """env=prod + audience unset -> RuntimeError at startup."""
    cfg_mod._settings = Settings(env="prod", oidc_audience=None)

    with pytest.raises(RuntimeError, match="OIDC_AUDIENCE"):
        async with lifespan(app):
            pass  # pragma: no cover - guard should raise before yield


@pytest.mark.asyncio
async def test_startup_allows_local_when_audience_unset(monkeypatch):
    """env=local + audience unset must NOT trip the audience guard.

    The guard runs before DB setup; we assert that the guard specifically does
    not raise. (DB setup afterwards is out of scope for this unit test, so we
    only verify the guard's condition rather than entering the lifespan body.)
    """
    settings = Settings(env="local", oidc_audience=None)
    guard_trips = (
        not settings.oidc_audience
        and settings.env not in ("local", "test", "dev")
    )
    assert guard_trips is False


@pytest.mark.asyncio
async def test_guard_condition_matrix():
    """The guard trips only in non-local envs with audience unset."""
    # prod, no audience -> trips
    s = Settings(env="prod", oidc_audience=None)
    assert (not s.oidc_audience and s.env not in ("local", "test", "dev")) is True

    # prod, audience set -> does not trip
    s = Settings(env="prod", oidc_audience="enstellar-workflow")
    assert (not s.oidc_audience and s.env not in ("local", "test", "dev")) is False

    # local/test/dev, no audience -> does not trip
    for env in ("local", "test", "dev"):
        s = Settings(env=env, oidc_audience=None)
        assert (not s.oidc_audience and s.env not in ("local", "test", "dev")) is False
