import base64

import pytest
import respx, httpx
from jose import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from simintero_authz.jwt_validator import JWTValidator
from simintero_authz.errors import AuthError

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_priv_pem = _key.private_bytes(serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
_pub = _key.public_key().public_numbers()


def _b64u(n: int) -> str:
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


_JWKS = {"keys": [{"kty": "RSA", "kid": "k1", "use": "sig", "alg": "RS256",
                   "n": _b64u(_pub.n), "e": _b64u(_pub.e)}]}
ISS = "https://kc/realms/simintero"
AUD = "enstellar-backend"


def _token(claims):
    return jwt.encode(claims, _priv_pem, algorithm="RS256", headers={"kid": "k1"})


@respx.mock
@pytest.mark.asyncio
async def test_valid_token_yields_claims():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    v = JWTValidator("https://kc/jwks", issuer=ISS, audience=AUD)
    claims = await v.validate(_token({"sub": "u1", "iss": ISS, "aud": AUD,
        "exp": 9999999999, "iat": 1, "tenant_id": "t_acme"}))
    assert claims.tenant_id == "t_acme"


@respx.mock
@pytest.mark.asyncio
async def test_missing_aud_rejected():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    v = JWTValidator("https://kc/jwks", issuer=ISS, audience=AUD)
    with pytest.raises(AuthError):
        await v.validate(_token({"sub": "u1", "iss": ISS, "exp": 9999999999, "iat": 1}))


@respx.mock
@pytest.mark.asyncio
async def test_wrong_issuer_rejected():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    v = JWTValidator("https://kc/jwks", issuer=ISS, audience=AUD)
    with pytest.raises(AuthError):
        await v.validate(_token({"sub": "u1", "iss": "https://evil", "aud": AUD,
            "exp": 9999999999, "iat": 1}))
