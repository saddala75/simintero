"""Tests for require_reviewer dependency.

Scenarios:
1. No Authorization header → 401 (HTTPBearer returns 401 when header absent in FastAPI >=0.111)
2. Expired token → 401
3. Valid token but role is 'admin' (not 'reviewer') → 403
4. Valid token but missing tenant_id claim → 403
5. Valid token with reviewer role and tenant_id → 200, principal dict returned
"""
import pytest
import enstellar_bff.auth as auth_module
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI, Depends

from enstellar_bff.auth import require_reviewer


# Build a minimal app that exposes a single route protected by require_reviewer
_test_app = FastAPI()


@_test_app.get("/protected")
async def protected(principal: dict = Depends(require_reviewer)) -> dict:
    return principal


@pytest.fixture
def client_factory(rsa_public_pem, monkeypatch):
    """Returns an async context-manager factory that patches _load_jwks."""

    async def _patched_load_jwks() -> dict:
        # python-jose accepts PEM directly when passed as the key to jwt.decode
        # but _load_jwks is expected to return a raw JWKS dict.
        # We store the PEM string in cache under a sentinel key so that
        # require_reviewer can pass it straight to jwt.decode.
        return {"_pem": rsa_public_pem.decode()}

    monkeypatch.setattr(auth_module, "_load_jwks", _patched_load_jwks)
    # Also patch jwt.decode to accept PEM from our fake JWKS
    original_decode = auth_module.jwt.decode

    def _patched_decode(token, key, algorithms):
        # key is the fake JWKS dict; extract PEM and decode
        pem = key.get("_pem", key)
        return original_decode(token, pem, algorithms=algorithms)

    monkeypatch.setattr(auth_module.jwt, "decode", _patched_decode)

    async def make_client():
        return AsyncClient(transport=ASGITransport(app=_test_app), base_url="http://test")

    return make_client


@pytest.mark.asyncio
async def test_no_token_returns_401(client_factory) -> None:
    async with await client_factory() as client:
        r = await client.get("/protected")
    assert r.status_code == 401  # FastAPI >=0.111 HTTPBearer returns 401 when header absent


@pytest.mark.asyncio
async def test_expired_token_returns_401(client_factory, make_token) -> None:
    token = make_token(expired=True)
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert "expired" in r.json()["detail"]


@pytest.mark.asyncio
async def test_wrong_role_returns_403(client_factory, make_token) -> None:
    token = make_token(roles=["admin"])
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "reviewer role required" in r.json()["detail"]


@pytest.mark.asyncio
async def test_missing_tenant_id_returns_403(client_factory, make_token) -> None:
    token = make_token(tenant_id=None)
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "tenant_id" in r.json()["detail"]


@pytest.mark.asyncio
async def test_valid_reviewer_token_returns_principal(client_factory, make_token) -> None:
    token = make_token(tenant_id="tenant-abc", roles=["reviewer"], sub="user-001")
    async with await client_factory() as client:
        r = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["tenant_id"] == "tenant-abc"
    assert "reviewer" in body["roles"]
    assert body["sub"] == "user-001"
