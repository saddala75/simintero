import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

TENANT_ID = "tenant-test"
ISSUER = "https://keycloak.local/realms/enstellar"


@pytest.fixture(scope="session")
def rsa_key_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


@pytest.fixture(scope="session")
def jwks(rsa_key_pair) -> dict[str, Any]:
    private_key, public_key = rsa_key_pair
    import base64

    def _int_to_base64url(n: int) -> str:
        length = (n.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()

    pub_numbers = public_key.public_numbers()
    return {
        "keys": [
            {
                "kty": "RSA",
                "kid": "test-key-1",
                "use": "sig",
                "alg": "RS256",
                "n": _int_to_base64url(pub_numbers.n),
                "e": _int_to_base64url(pub_numbers.e),
            }
        ]
    }


def make_token(
    private_key,
    *,
    tenant_id: str = TENANT_ID,
    sub: str = "user-123",
    issuer: str = ISSUER,
    scope: str = "openid profile",
    expired: bool = False,
    kid: str = "test-key-1",
    audience: str | list[str] | None = None,
) -> str:
    now = int(time.time())
    exp = now - 60 if expired else now + 3600
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    payload: dict[str, Any] = {
        "sub": sub,
        "iss": issuer,
        "iat": now,
        "exp": exp,
        "tenant_id": tenant_id,
        "scope": scope,
    }
    if audience is not None:
        payload["aud"] = audience
    return jwt.encode(
        payload,
        pem.decode(),
        algorithm="RS256",
        headers={"kid": kid},
    )
