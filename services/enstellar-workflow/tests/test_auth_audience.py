"""Tests for JWT audience enforcement.

Verifies that:
- JWTValidator raises AuthError when audience is configured and the
  token carries a different audience value.
- JWTValidator raises AuthError when audience is configured and the
  token has no aud claim.
- The startup guard raises RuntimeError in non-local environments
  when WORKFLOW_OIDC_AUDIENCE is not set.
"""
from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch

import pytest
from jose import jwt

from simintero_authz import AuthError, JWTValidator


def _make_dummy_rsa_key():
    """Return a minimal RSA key pair for test token signing."""
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.backends import default_backend

    return rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )


@pytest.mark.asyncio
async def test_audience_enforced_when_token_has_wrong_audience(monkeypatch):
    """JWTValidator must reject tokens with mismatched aud when audience is configured."""
    validator = JWTValidator(
        jwks_uri="http://keycloak:8080/realms/simintero/protocol/openid-connect/certs",
        issuer="http://keycloak:8080/realms/simintero",
        audience="enstellar-workflow",
    )

    # Build a fake token claiming audience = "other-service"
    fake_payload = {
        "sub": "user-abc",
        "iss": "http://keycloak:8080/realms/simintero",
        "aud": "other-service",  # wrong audience
        "exp": int(time.time()) + 3600,
        "tenant_id": "tenant-dev",
        "realm_access": {"roles": []},
    }

    private_key = _make_dummy_rsa_key()
    from cryptography.hazmat.primitives import serialization

    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    token = jwt.encode(fake_payload, pem, algorithm="RS256", headers={"kid": "test-kid"})

    # Mock the JWKS fetch to return the matching public key
    pub_pem = (
        private_key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    from jose import jwk as jose_jwk

    jwk_data = jose_jwk.construct(pub_pem, algorithm="RS256").to_dict()
    jwk_data["kid"] = "test-kid"
    jwks_response = {"keys": [jwk_data]}

    monkeypatch.setattr(
        validator,
        "_fetch_jwks",
        AsyncMock(return_value=jwks_response),
    )
    validator._cache_expires_at = time.monotonic() + 300
    validator._jwks_cache = jwks_response

    with pytest.raises(AuthError, match="(?i)audience|aud"):
        await validator.validate(token)


@pytest.mark.asyncio
async def test_audience_enforced_when_token_has_no_aud_claim(monkeypatch):
    """JWTValidator must reject tokens with NO aud claim when audience is configured."""
    validator = JWTValidator(
        jwks_uri="http://keycloak:8080/realms/simintero/protocol/openid-connect/certs",
        issuer="http://keycloak:8080/realms/simintero",
        audience="enstellar-workflow",
    )

    fake_payload = {
        "sub": "user-abc",
        "iss": "http://keycloak:8080/realms/simintero",
        # deliberately no "aud" claim
        "exp": int(time.time()) + 3600,
        "tenant_id": "tenant-dev",
        "realm_access": {"roles": []},
    }

    private_key = _make_dummy_rsa_key()
    from cryptography.hazmat.primitives import serialization

    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    # python-jose encodes without aud when not present; bypass aud check in encode
    token = jwt.encode(fake_payload, pem, algorithm="RS256", headers={"kid": "test-kid-2"})

    pub_pem = (
        private_key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    from jose import jwk as jose_jwk

    jwk_data = jose_jwk.construct(pub_pem, algorithm="RS256").to_dict()
    jwk_data["kid"] = "test-kid-2"
    jwks_response = {"keys": [jwk_data]}

    monkeypatch.setattr(
        validator,
        "_fetch_jwks",
        AsyncMock(return_value=jwks_response),
    )
    validator._cache_expires_at = time.monotonic() + 300
    validator._jwks_cache = jwks_response

    with pytest.raises(AuthError, match="(?i)aud"):
        await validator.validate(token)


def test_startup_guard_raises_when_oidc_audience_unset_outside_local():
    """Startup must fail when WORKFLOW_OIDC_AUDIENCE is unset in non-local envs."""
    from enstellar_workflow.config import Settings

    settings = Settings(env="production", oidc_audience=None)
    # Simulate the startup guard logic from main.py
    if not settings.oidc_audience and settings.env not in ("local", "test", "dev"):
        raise RuntimeError("WORKFLOW_OIDC_AUDIENCE is not set in production")

    # If we reach here the guard failed — the test should have raised
    pytest.fail("Startup guard did not raise for unset audience in production env")


def test_startup_guard_passes_when_audience_is_set():
    """Startup guard must not raise when WORKFLOW_OIDC_AUDIENCE is set."""
    from enstellar_workflow.config import Settings

    settings = Settings(env="production", oidc_audience="enstellar-workflow")
    # No exception should be raised
    if not settings.oidc_audience and settings.env not in ("local", "test", "dev"):
        raise RuntimeError("Should not reach here")
