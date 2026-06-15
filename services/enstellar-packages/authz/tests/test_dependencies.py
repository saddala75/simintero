import pytest
import respx
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from enstellar_authz.dependencies import AuthedRequest
from enstellar_authz.jwt_validator import JWTValidator
from .conftest import ISSUER, TENANT_ID, make_token


def _build_app(private_key, jwks) -> FastAPI:
    app = FastAPI()
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"

    @app.on_event("startup")
    async def _startup() -> None:
        with respx.mock:
            respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
            v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
            await v._get_jwks()
        app.state.jwt_validator = v

    @app.get("/protected")
    async def protected(ctx: AuthedRequest):
        return {"tenant_id": ctx.tenant_id, "sub": ctx.subject}

    @app.get("/public")
    async def public():
        return {"status": "ok"}

    return app


@pytest.fixture
def client(rsa_key_pair, jwks):
    private_key, _ = rsa_key_pair
    app = _build_app(private_key, jwks)
    with TestClient(app) as c:
        yield c, private_key


def test_protected_without_token_returns_401(client):
    c, _ = client
    resp = c.get("/protected")
    assert resp.status_code == 401


def test_protected_with_valid_token_returns_200(client):
    c, private_key = client
    token = make_token(private_key)
    resp = c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["tenant_id"] == TENANT_ID


def test_protected_with_expired_token_returns_401(client):
    c, private_key = client
    token = make_token(private_key, expired=True)
    resp = c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_public_endpoint_no_auth_needed(client):
    c, _ = client
    resp = c.get("/public")
    assert resp.status_code == 200


def test_token_without_tenant_id_returns_401(rsa_key_pair, jwks):
    private_key, _ = rsa_key_pair
    import time
    from jose import jwt as jose_jwt
    from cryptography.hazmat.primitives import serialization

    now = int(time.time())
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token = jose_jwt.encode(
        {"sub": "user-no-tenant", "iss": ISSUER, "iat": now, "exp": now + 3600},
        pem.decode(),
        algorithm="RS256",
        headers={"kid": "test-key-1"},
    )
    app = _build_app(private_key, jwks)
    with TestClient(app) as c:
        resp = c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Problem 2: Whitespace tenant_id
# ---------------------------------------------------------------------------

def test_whitespace_only_tenant_id_returns_401(rsa_key_pair, jwks):
    """A token whose tenant_id claim is only whitespace must be rejected with
    401 — identical behaviour to a missing tenant_id (invariant #5)."""
    private_key, _ = rsa_key_pair
    token = make_token(private_key, tenant_id="   ")
    app = _build_app(private_key, jwks)
    with TestClient(app) as c:
        resp = c.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Problem 3: Audience enforcement — startup validation helper
# ---------------------------------------------------------------------------

def test_validate_jwt_config_raises_if_no_audience():
    """validate_jwt_config must raise RuntimeError when the validator was
    created without an expected audience — fail fast at startup."""
    from enstellar_authz.dependencies import validate_jwt_config

    v = JWTValidator(
        jwks_uri="https://keycloak.local/realms/enstellar/protocol/openid-connect/certs",
        issuer=ISSUER,
        # audience intentionally omitted
    )
    with pytest.raises(RuntimeError, match="audience"):
        validate_jwt_config(v)


def test_validate_jwt_config_passes_with_audience():
    """validate_jwt_config must not raise when audience is configured."""
    from enstellar_authz.dependencies import validate_jwt_config

    v = JWTValidator(
        jwks_uri="https://keycloak.local/realms/enstellar/protocol/openid-connect/certs",
        issuer=ISSUER,
        audience="enstellar-app",
    )
    validate_jwt_config(v)  # must not raise
