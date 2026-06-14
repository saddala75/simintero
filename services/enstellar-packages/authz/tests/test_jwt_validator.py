import asyncio

import pytest
import respx
import httpx

from enstellar_authz.exceptions import AuthError
from enstellar_authz.jwt_validator import FORCE_REFRESH_COOLDOWN_SECONDS, JWTValidator
from .conftest import ISSUER, TENANT_ID, make_token


@pytest.fixture
def validator(jwks, rsa_key_pair):
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    with respx.mock:
        respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        asyncio.run(v._get_jwks())
    return v, private_key


def test_valid_token_returns_claims(validator, jwks):
    v, private_key = validator
    token = make_token(private_key)
    with respx.mock:
        claims = asyncio.run(v.validate(token))
    assert claims.tenant_id == TENANT_ID
    assert claims.sub == "user-123"
    assert "openid" in claims.scopes


def test_expired_token_raises(validator):
    v, private_key = validator
    token = make_token(private_key, expired=True)
    with pytest.raises(AuthError, match="expired"):
        asyncio.run(v.validate(token))


def test_wrong_issuer_raises(validator):
    v, private_key = validator
    token = make_token(private_key, issuer="https://evil.example.com")
    with pytest.raises(AuthError):
        asyncio.run(v.validate(token))


def test_malformed_token_raises(validator):
    v, _ = validator
    with pytest.raises(AuthError, match="Invalid token format"):
        asyncio.run(v.validate("not.a.valid.jwt"))


def test_unknown_kid_refreshes_and_raises(rsa_key_pair, jwks):
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    token = make_token(private_key, kid="unknown-kid")
    with respx.mock:
        respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        asyncio.run(v._get_jwks())
        with pytest.raises(AuthError, match="signing key not found"):
            asyncio.run(v.validate(token))


# ---------------------------------------------------------------------------
# Problem 1: JWKS force-refresh rate-limit
# ---------------------------------------------------------------------------

def test_force_refresh_within_cooldown_skips_http(rsa_key_pair, jwks):
    """A second force-refresh within the cooldown window must NOT call the
    JWKS endpoint — prevents unbounded HTTP calls on a burst of bad tokens."""
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    with respx.mock:
        route = respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        asyncio.run(v._get_jwks())                        # initial load  → call_count = 1
        asyncio.run(v._get_jwks(force_refresh=True))      # first force-refresh → call_count = 2
        assert route.call_count == 2

        asyncio.run(v._get_jwks(force_refresh=True))      # within cooldown → must NOT call HTTP
        assert route.call_count == 2, (
            "Force-refresh within cooldown should not call the JWKS endpoint"
        )


def test_force_refresh_after_cooldown_calls_http(rsa_key_pair, jwks):
    """A force-refresh after the cooldown expires DOES hit the JWKS endpoint."""
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    with respx.mock:
        route = respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        asyncio.run(v._get_jwks())                        # initial load
        asyncio.run(v._get_jwks(force_refresh=True))      # first force-refresh
        count_after_first_refresh = route.call_count

        # Simulate cooldown expiry by backdating the timestamp
        v._last_force_refresh_at -= (FORCE_REFRESH_COOLDOWN_SECONDS + 1)

        asyncio.run(v._get_jwks(force_refresh=True))      # after cooldown → must call HTTP
        assert route.call_count == count_after_first_refresh + 1


# ---------------------------------------------------------------------------
# Problem 3: Audience enforcement
# ---------------------------------------------------------------------------

def _make_validator_with_audience(jwks_uri: str, jwks_data: dict) -> "JWTValidator":
    with respx.mock:
        respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks_data))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER, audience="enstellar-app")
        asyncio.run(v._get_jwks())
    return v


def test_token_without_aud_raises_when_audience_required(rsa_key_pair, jwks):
    """A validator configured with an expected audience must reject tokens
    that carry no aud claim at all."""
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    v = _make_validator_with_audience(jwks_uri, jwks)

    token = make_token(private_key)  # no audience= → no aud claim in token
    with pytest.raises(AuthError):
        asyncio.run(v.validate(token))


def test_token_with_wrong_aud_raises(rsa_key_pair, jwks):
    """A validator configured with an expected audience must reject tokens
    whose aud claim does not match."""
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    v = _make_validator_with_audience(jwks_uri, jwks)

    token = make_token(private_key, audience="wrong-service")
    with pytest.raises(AuthError):
        asyncio.run(v.validate(token))


def test_token_with_correct_aud_is_accepted(rsa_key_pair, jwks):
    """A token whose aud matches the configured audience must be accepted."""
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    v = _make_validator_with_audience(jwks_uri, jwks)

    token = make_token(private_key, audience="enstellar-app")
    claims = asyncio.run(v.validate(token))
    assert claims.tenant_id == TENANT_ID


# ---------------------------------------------------------------------------
# Issue 3: list-form aud claim
# ---------------------------------------------------------------------------

@pytest.fixture
def make_validator(rsa_key_pair, jwks):
    """Factory fixture: returns a callable that builds a pre-loaded JWTValidator."""
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"

    def _factory(*, audience: str | None = None) -> JWTValidator:
        with respx.mock:
            respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
            v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER, audience=audience)
            asyncio.run(v._get_jwks())
        return v

    return _factory


@pytest.mark.parametrize("aud", [
    "enstellar-app",               # bare string
    ["enstellar-app"],             # single-item list
    ["enstellar-app", "account"],  # multi-audience list (should pass)
])
def test_token_with_valid_aud_forms_is_accepted(make_validator, rsa_key_pair, aud):
    """Validator must accept the expected audience whether it arrives as a bare
    string or as a list (RFC 7519 §4.1.3 permits both forms)."""
    private_key, _ = rsa_key_pair
    v = make_validator(audience="enstellar-app")
    token = make_token(private_key, audience=aud)
    claims = asyncio.run(v.validate(token))
    assert claims is not None


@pytest.mark.parametrize("aud", [
    "wrong-service",
    ["wrong-service", "account"],
])
def test_token_with_invalid_aud_list_raises(make_validator, rsa_key_pair, aud):
    """Validator must reject tokens whose aud does not include the expected
    audience, whether the claim is a string or a list."""
    private_key, _ = rsa_key_pair
    v = make_validator(audience="enstellar-app")
    token = make_token(private_key, audience=aud)
    with pytest.raises(AuthError):
        asyncio.run(v.validate(token))
