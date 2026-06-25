"""Tests for the role-gated reviewer/assigner auth deps (P2).

These deps capture the JWT ``sub`` (the authenticated user id) and enforce a
realm role, mirroring the proven BFF ``require_reviewer`` pattern. Appeal
decisions stamp the reviewer actor from ``ReviewerContext.sub`` — NEVER from the
request body.

We mock ``enstellar_workflow.auth.jwt_validator.validate`` with an AsyncMock
returning a real ``TokenClaims``; no network/JWKS call is made. The deps are
async generators (``yield``), so we drive them with ``__anext__`` / ``aclose``.
"""
from unittest.mock import AsyncMock

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from simintero_authz import AuthError, ForbiddenError
from simintero_authz.models import TokenClaims

import enstellar_workflow.auth as auth_module
from enstellar_workflow.auth import (
    ReviewerContext,
    require_appeals_assigner,
    require_reviewer,
)


def _claims(roles: list[str], *, tenant_id: str | None = "t1", sub: str = "user-001") -> TokenClaims:
    return TokenClaims(
        sub=sub,
        iss="https://kc/realms/simintero",
        aud="enstellar",
        exp=9999999999,
        iat=0,
        tenant_id=tenant_id,
        realm_access={"roles": roles},
    )


def _creds(token: str = "the-token") -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.fixture
def patch_validate(monkeypatch):
    """Return a setter that mocks jwt_validator.validate to return given claims."""

    def _set(claims: TokenClaims) -> None:
        monkeypatch.setattr(
            auth_module.jwt_validator, "validate", AsyncMock(return_value=claims)
        )

    return _set


async def _drive(agen):
    """Yield the first value of an async-generator dep, then close it."""
    ctx = await agen.__anext__()
    await agen.aclose()
    return ctx


@pytest.mark.asyncio
async def test_require_reviewer_yields_context_with_sub(patch_validate) -> None:
    patch_validate(_claims(["reviewer"], sub="user-001"))
    ctx = await _drive(require_reviewer(_creds()))
    assert isinstance(ctx, ReviewerContext)
    assert ctx.sub == "user-001"
    assert ctx.tenant_id == "t1"
    assert "reviewer" in ctx.roles


@pytest.mark.asyncio
async def test_require_reviewer_without_role_raises_forbidden(patch_validate) -> None:
    patch_validate(_claims(["admin"]))
    with pytest.raises(ForbiddenError):
        await require_reviewer(_creds()).__anext__()


@pytest.mark.asyncio
async def test_require_appeals_assigner_yields_context_with_sub(patch_validate) -> None:
    patch_validate(_claims(["appeals_coordinator"], sub="coord-7"))
    ctx = await _drive(require_appeals_assigner(_creds()))
    assert isinstance(ctx, ReviewerContext)
    assert ctx.sub == "coord-7"
    assert ctx.tenant_id == "t1"
    assert "appeals_coordinator" in ctx.roles


@pytest.mark.asyncio
async def test_require_appeals_assigner_without_role_raises_forbidden(patch_validate) -> None:
    patch_validate(_claims(["reviewer"]))
    with pytest.raises(ForbiddenError):
        await require_appeals_assigner(_creds()).__anext__()


@pytest.mark.asyncio
async def test_missing_creds_raises_auth_error() -> None:
    with pytest.raises(AuthError):
        await require_reviewer(None).__anext__()


@pytest.mark.asyncio
async def test_missing_tenant_id_raises_auth_error(patch_validate) -> None:
    patch_validate(_claims(["reviewer"], tenant_id=None))
    with pytest.raises(AuthError):
        await require_reviewer(_creds()).__anext__()


@pytest.mark.asyncio
async def test_blank_sub_raises_auth_error(patch_validate) -> None:
    """A blank sub must be rejected — it is the reviewer identity matched by the
    decide-time assignment gate; an empty sub could slip a blank assigned_to."""
    patch_validate(_claims(["reviewer"], sub="   "))
    with pytest.raises(AuthError):
        await require_reviewer(_creds()).__anext__()
