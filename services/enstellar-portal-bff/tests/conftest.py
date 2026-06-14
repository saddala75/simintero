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


@pytest.fixture(scope="session")
def rsa_private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def rsa_public_pem(rsa_private_key) -> bytes:
    return rsa_private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _make_token(
    private_key,
    tenant_id: str | None = "tenant-abc",
    roles: list[str] | None = None,
    sub: str = "user-001",
    expired: bool = False,
) -> str:
    if roles is None:
        roles = ["reviewer"]
    now = int(time.time())
    exp = (now - 60) if expired else (now + 3600)
    payload: dict[str, Any] = {"sub": sub, "exp": exp, "iat": now}
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id
    payload["roles"] = roles
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(payload, private_pem, algorithm="RS256")


@pytest.fixture
def make_token(rsa_private_key):
    """Returns a factory: make_token(tenant_id=..., roles=..., expired=...)."""
    return lambda **kw: _make_token(rsa_private_key, **kw)
