import base64

import httpx
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

from simintero_authz.errors import AuthError
from simintero_authz.fastapi import make_require_auth
from simintero_authz.jwt_validator import JWTValidator
from simintero_tenant_context import get_context

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


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _require_auth():
    return make_require_auth(JWTValidator("https://kc/jwks", issuer=ISS, audience=AUD))


@respx.mock
@pytest.mark.asyncio
async def test_valid_token_sets_and_clears_context():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    require_auth = _require_auth()
    token = _token({"sub": "u1", "iss": ISS, "aud": AUD, "exp": 9999999999,
                    "iat": 1, "tenant_id": "t_acme",
                    "realm_access": {"roles": ["medical_director"]}})
    gen = require_auth(creds=_creds(token))
    ctx, raw = await gen.__anext__()
    assert ctx.tenant_id == "t_acme"
    assert raw == token
    assert ctx.roles == ["medical_director"]
    # set during the request
    assert get_context().tenant_id == "t_acme"
    # FastAPI runs the teardown after the response -> context cleared
    await gen.aclose()
    with pytest.raises(RuntimeError):
        get_context()


@respx.mock
@pytest.mark.asyncio
async def test_missing_creds_rejected():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    require_auth = _require_auth()
    gen = require_auth(creds=None)
    with pytest.raises(AuthError):
        await gen.__anext__()


@respx.mock
@pytest.mark.asyncio
async def test_missing_tenant_id_rejected():
    respx.get("https://kc/jwks").mock(return_value=httpx.Response(200, json=_JWKS))
    require_auth = _require_auth()
    token = _token({"sub": "u1", "iss": ISS, "aud": AUD, "exp": 9999999999, "iat": 1})
    gen = require_auth(creds=_creds(token))
    with pytest.raises(AuthError):
        await gen.__anext__()
