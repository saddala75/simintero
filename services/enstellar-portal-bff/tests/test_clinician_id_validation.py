"""Tests for clinician_id identity enforcement on the adverse-decision endpoint.

Security invariant: clinician_id in the request body must match the authenticated
user's JWT sub. A reviewer must not be able to record a sign-off attributed to
another clinician.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def make_token(monkeypatch):
    """Return a factory that produces fake JWT bearer strings.

    The BFF test suite overrides require_reviewer/require_auth with fixture
    overrides; this fixture provides tokens shaped for those overrides.
    """
    def _make(sub: str, roles: list[str] | None = None) -> str:  # noqa: ANN001
        # In unit tests the BFF dependency is overridden; just return a
        # string that the override can inspect.
        return f"fake-token:sub={sub}:roles={','.join(roles or [])}"
    return _make


def test_adverse_decision_rejects_mismatched_clinician_id(make_token):
    """clinician_id in body must match authenticated user sub — expect 403."""
    from enstellar_bff.main import app
    from enstellar_bff.auth import require_reviewer
    from enstellar_bff.models import ReviewerCtx  # type: ignore[attr-defined]

    class _FakeCtx:
        tenant_id = "tenant-dev"
        sub = "reviewer-abc"

    app.dependency_overrides[require_reviewer] = lambda: ("override", "fake-bearer")

    # Patch require_reviewer to return a context where sub="reviewer-abc"
    async def _fake_reviewer():
        return (_FakeCtx(), "fake-bearer")

    app.dependency_overrides[require_reviewer] = _fake_reviewer

    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.post(
            "/bff/cases/00000000-0000-0000-0000-000000000001/adverse-decision",
            json={
                "clinician_id": "reviewer-xyz",   # different from token sub
                "reason": "Not medically necessary",
                "outcome": "denied",
                "sign_off_confirmed": True,
            },
            headers={"Authorization": "Bearer fake-token"},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 403
    detail = resp.json().get("detail", "")
    assert "clinician_id" in detail.lower()
