"""Tests for the require_reviewer dependency (simintero-authz adoption).

Scenarios:
1. No Authorization header → 401
2. Expired token → 401
3. Valid token but role is 'admin' (not 'reviewer') → 403
4. Valid token but missing tenant_id claim → 401
5. Valid token with reviewer role and tenant_id → 200, context returned

The require_reviewer dependency validates the Keycloak JWT via the singleton
JWTValidator (realm ``simintero``). We patch the validator's JWKS fetch so no
network call is made; the issuer is the one in BffSettings.oidc_issuer.
"""
import pytest
from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from simintero_authz import AuthError, ForbiddenError

import enstellar_bff.auth as auth_module
from enstellar_bff.auth import BffContext, require_reviewer

# Minimal app protected by the real require_reviewer dependency, wired with the
# same AuthError/ForbiddenError → 401/403 handlers the BFF registers in main.py.
_test_app = FastAPI()


@_test_app.exception_handler(AuthError)
async def _auth_error_handler(_, exc: AuthError) -> JSONResponse:
    return JSONResponse(status_code=401, content={"detail": str(exc)})


@_test_app.exception_handler(ForbiddenError)
async def _forbidden_error_handler(_, exc: ForbiddenError) -> JSONResponse:
    return JSONResponse(
        status_code=getattr(exc, "status", 403), content={"detail": str(exc)}
    )


@_test_app.get("/protected")
async def protected(auth: tuple = Depends(require_reviewer)) -> dict:
    ctx, _bearer = auth
    assert isinstance(ctx, BffContext)
    return {"tenant_id": ctx.tenant_id, "roles": ctx.roles, "sub": ctx.sub}


@pytest.fixture(autouse=True)
def patch_jwks(monkeypatch, jwks):
    """Serve the public JWKS from the singleton validator without a network call."""

    async def _fake_fetch_jwks() -> dict:
        return jwks

    monkeypatch.setattr(auth_module.validator, "_fetch_jwks", _fake_fetch_jwks)
    # Force a cache refresh on the next validate() call.
    monkeypatch.setattr(auth_module.validator, "_cache_expires_at", 0.0)


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=_test_app), base_url="http://test")


@pytest.mark.asyncio
async def test_no_token_returns_401(client) -> None:
    async with client as c:
        r = await c.get("/protected")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_returns_401(client, make_token) -> None:
    token = make_token(expired=True)
    async with client as c:
        r = await c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_wrong_role_returns_403(client, make_token) -> None:
    token = make_token(roles=["admin"])
    async with client as c:
        r = await c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "reviewer role required" in r.json()["detail"]


@pytest.mark.asyncio
async def test_missing_tenant_id_returns_401(client, make_token) -> None:
    token = make_token(tenant_id=None)
    async with client as c:
        r = await c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert "tenant_id" in r.json()["detail"]


@pytest.mark.asyncio
async def test_valid_reviewer_token_returns_principal(client, make_token) -> None:
    token = make_token(tenant_id="tenant-abc", roles=["reviewer"], sub="user-001")
    async with client as c:
        r = await c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["tenant_id"] == "tenant-abc"
    assert "reviewer" in body["roles"]
    assert body["sub"] == "user-001"
