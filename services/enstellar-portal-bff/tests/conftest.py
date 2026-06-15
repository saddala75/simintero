"""Shared fixtures for BFF tests.

JWT generation uses RSA-2048 so tests mirror real Keycloak token validation.
The private key is generated once per session; the public JWKS is injected via
monkeypatch into auth._load_jwks so no network calls are made.
"""
from __future__ import annotations

import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from enstellar_bff.auth import BffContext

# Bearer forwarded downstream by the routers under the new (ctx, bearer) shape.
TEST_BEARER = "test-bearer-token"


def make_principal(
    tenant_id: str = "tenant-abc",
    roles: list[str] | None = None,
    sub: str = "user-001",
    bearer: str = TEST_BEARER,
) -> tuple[BffContext, str]:
    """Build the (BffContext, bearer) tuple the auth dependency now yields.

    Tests override ``require_reviewer`` with ``lambda: make_principal(...)`` so
    the routers receive a valid context + bearer (the reviewer-role gate has
    already been satisfied by the override replacing the real dependency)."""
    ctx = BffContext(
        tenant_id=tenant_id,
        roles=roles if roles is not None else ["reviewer"],
        sub=sub,
        principal_type="human",
    )
    return ctx, bearer


@pytest.fixture(scope="session")
def rsa_private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def rsa_public_pem(rsa_private_key) -> bytes:
    return rsa_private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


# Issuer must match BffSettings.oidc_issuer so the JWTValidator accepts the token.
from enstellar_bff.config import settings as _settings  # noqa: E402

TEST_ISSUER = _settings.oidc_issuer
TEST_KID = "test-key-1"


def _make_token(
    private_key,
    tenant_id: str | None = "tenant-abc",
    roles: list[str] | None = None,
    sub: str = "user-001",
    expired: bool = False,
    issuer: str | None = None,
) -> str:
    if roles is None:
        roles = ["reviewer"]
    now = int(time.time())
    exp = (now - 60) if expired else (now + 3600)
    payload: dict[str, Any] = {
        "sub": sub,
        "exp": exp,
        "iat": now,
        "iss": issuer if issuer is not None else TEST_ISSUER,
        # roles are derived from realm_access.roles in the simintero TokenClaims
        "realm_access": {"roles": roles},
    }
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(
        payload, private_pem, algorithm="RS256", headers={"kid": TEST_KID}
    )


@pytest.fixture
def make_token(rsa_private_key):
    """Returns a factory: make_token(tenant_id=..., roles=..., expired=...)."""
    return lambda **kw: _make_token(rsa_private_key, **kw)


@pytest.fixture(scope="session")
def jwks(rsa_private_key) -> dict:
    """Public JWKS document matching the session RSA key (kid = TEST_KID).

    Mirrors what Keycloak's JWKS endpoint would return so JWTValidator can
    construct the verifying key without any network call."""
    from jose import jwk

    public_jwk = jwk.construct(
        rsa_private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ),
        algorithm="RS256",
    ).to_dict()
    public_jwk["kid"] = TEST_KID
    return {"keys": [public_jwk]}
