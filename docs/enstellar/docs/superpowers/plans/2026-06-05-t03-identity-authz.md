# T03 — Identity / AuthZ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **SENSITIVE — AUTH CLASS.** This task touches identity, token issuance, and tenant boundary enforcement. Per `guardrails.md`, a **senior engineer must review and approve the PR** before merge. Do not merge without that approval.

**Goal:** Configure Keycloak to issue SMART on FHIR (authorization_code + PKCE) and SMART Backend Services (client_credentials + private_key_jwt) tokens; enforce token validation + `tenant_id` extraction in a shared Python auth package (`packages/authz`); enforce the same in the JVM interop skeleton (`services/interop`); prove no FHIR endpoint (except `/metadata`) is reachable without a valid token.

**Architecture:** Keycloak realm `enstellar` is imported on container start via `--import-realm`. Python services use a `packages/authz` FastAPI dependency that validates JWT signatures via JWKS, extracts `tenant_id`, and populates a `TenantContext` ContextVar. The JVM Spring Boot skeleton uses Spring Security OAuth2 Resource Server for JWT validation plus a HAPI `IAnonymousRequestInterceptor` to populate and enforce `TenantContext`. The `/fhir/metadata` endpoint is explicitly permitted without a token (SMART well-known requirement).

**Tech Stack:** Keycloak 24.0.4; Python 3.12 + FastAPI + python-jose + httpx + pytest; Java 21 + Spring Boot 3.3 + Spring Security + Nimbus JOSE + HAPI FHIR 7.4 + JUnit 5 + Testcontainers.

---

## File Map

**New files:**
```
infra/compose/keycloak/
  enstellar-realm.json              # Keycloak realm import

packages/authz/
  pyproject.toml
  enstellar_authz/
    __init__.py
    context.py                      # TenantContext (ContextVar)
    models.py                       # TokenClaims Pydantic model
    jwt_validator.py                # JWKS-based JWT validator
    dependencies.py                 # FastAPI require_auth() dependency
    exceptions.py                   # AuthError, TenantMissingError
  tests/
    conftest.py
    test_jwt_validator.py
    test_dependencies.py

services/interop/
  settings.gradle.kts
  build.gradle.kts
  gradle/wrapper/...                # Gradle wrapper (generated)
  gradlew  gradlew.bat
  src/
    main/java/com/simintero/enstellar/interop/
      InteropApplication.java
      auth/
        TenantContext.java
        TenantInterceptor.java
        JwksValidator.java
      config/
        SecurityConfig.java
        InterceptorConfig.java
    main/resources/
      application.yml
    test/java/com/simintero/enstellar/interop/
      SecurityIntegrationTest.java
```

**Modified files:**
```
infra/compose/docker-compose.yml    # keycloak: add --import-realm + volume mount
Makefile                            # Add authz test target
.github/workflows/ci.yml           # Add authz test job
.claude/task-graph.md              # Mark T03 [~] in-progress → [x] done (after senior review)
packages/authz/.gitkeep            # Delete (replaced by real files)
services/interop/.gitkeep          # Delete (replaced by real files)
```

---

## Task 1: Keycloak realm configuration

**Files:**
- Create: `infra/compose/keycloak/enstellar-realm.json`
- Modify: `infra/compose/docker-compose.yml`

- [ ] **Step 1: Create enstellar-realm.json**

This is the realm import that Keycloak loads on first start. It defines the `enstellar` realm, two clients (app + backend), SMART scopes, a custom `tenant_id` claim mapper, and a test user.

```json
{
  "realm": "enstellar",
  "enabled": true,
  "displayName": "Enstellar",
  "sslRequired": "external",
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "editUsernameAllowed": false,
  "bruteForceProtected": true,

  "clients": [
    {
      "clientId": "enstellar-app",
      "name": "Enstellar Application (SMART App Launch)",
      "description": "SMART on FHIR authorization_code + PKCE client for the reviewer UI",
      "enabled": true,
      "publicClient": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": false,
      "redirectUris": ["http://localhost:3000/*", "http://localhost:5173/*"],
      "webOrigins": ["+"],
      "protocol": "openid-connect",
      "defaultClientScopes": ["openid", "profile", "email", "fhir_scopes"],
      "optionalClientScopes": ["offline_access"]
    },
    {
      "clientId": "enstellar-backend",
      "name": "Enstellar Backend Services (SMART Backend Services)",
      "description": "SMART Backend Services client_credentials + private_key_jwt for service-to-service",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": false,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": true,
      "clientAuthenticatorType": "client-jwt",
      "secret": null,
      "protocol": "openid-connect",
      "defaultClientScopes": ["openid", "fhir_scopes"],
      "optionalClientScopes": [],
      "attributes": {
        "use.jwks.url": "false",
        "jwt.credential.public.key.type": "RSA"
      }
    },
    {
      "clientId": "enstellar-test-client",
      "name": "Test client (client_secret, CI only)",
      "description": "Used only in integration tests — NOT for production",
      "enabled": true,
      "publicClient": false,
      "standardFlowEnabled": false,
      "directAccessGrantsEnabled": true,
      "serviceAccountsEnabled": true,
      "clientAuthenticatorType": "client-secret",
      "secret": "test-client-secret",
      "protocol": "openid-connect",
      "defaultClientScopes": ["openid", "profile", "email", "fhir_scopes"],
      "optionalClientScopes": []
    }
  ],

  "clientScopes": [
    {
      "name": "fhir_scopes",
      "description": "SMART on FHIR resource scopes",
      "protocol": "openid-connect",
      "attributes": { "include.in.token.scope": "true" },
      "protocolMappers": [
        {
          "name": "tenant_id_mapper",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-attribute-mapper",
          "consentRequired": false,
          "config": {
            "userinfo.token.claim": "true",
            "user.attribute": "tenant_id",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "claim.name": "tenant_id",
            "jsonType.label": "String"
          }
        },
        {
          "name": "fhir_user_mapper",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-property-mapper",
          "consentRequired": false,
          "config": {
            "userinfo.token.claim": "true",
            "user.attribute": "email",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "claim.name": "fhirUser",
            "jsonType.label": "String"
          }
        }
      ]
    }
  ],

  "users": [
    {
      "username": "testreviewer",
      "enabled": true,
      "email": "testreviewer@enstellar.local",
      "firstName": "Test",
      "lastName": "Reviewer",
      "attributes": {
        "tenant_id": ["tenant-test"]
      },
      "credentials": [
        {
          "type": "password",
          "value": "reviewer-password",
          "temporary": false
        }
      ],
      "clientRoles": {}
    }
  ],

  "roles": {
    "realm": [
      { "name": "reviewer", "description": "PA reviewer" },
      { "name": "clinical-reviewer", "description": "Clinician reviewer — may sign off on adverse" },
      { "name": "admin", "description": "Tenant admin" }
    ]
  }
}
```

- [ ] **Step 2: Update docker-compose.yml keycloak service**

Change the `keycloak` service to import the realm on start:

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:24.0.4
    command: start-dev --import-realm
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://workflow-db:5432/keycloak
      KC_DB_USERNAME: workflow
      KC_DB_PASSWORD: ${WORKFLOW_DB_PASSWORD:-workflow_secret}
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-admin}
    ports:
      - "${KEYCLOAK_PORT:-8081}:8080"
    volumes:
      - ./keycloak/enstellar-realm.json:/opt/keycloak/data/import/enstellar-realm.json:ro
    depends_on:
      workflow-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/8080; printf 'GET /realms/master HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n' >&3; read -t 5 line <&3; [[ \"$$line\" == *200* ]]"]
      interval: 30s
      timeout: 10s
      retries: 10
      start_period: 60s
```

- [ ] **Step 3: Validate compose config**

```bash
docker compose -f infra/compose/docker-compose.yml config --quiet
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add infra/compose/keycloak/enstellar-realm.json infra/compose/docker-compose.yml
git commit -m "feat(T03): Keycloak enstellar realm — SMART on FHIR + Backend Services + tenant_id claim"
```

---

## Task 2: Python auth package — enstellar_authz

**Files:**
- Create: `packages/authz/pyproject.toml`
- Create: `packages/authz/enstellar_authz/__init__.py`
- Create: `packages/authz/enstellar_authz/exceptions.py`
- Create: `packages/authz/enstellar_authz/context.py`
- Create: `packages/authz/enstellar_authz/models.py`
- Create: `packages/authz/enstellar_authz/jwt_validator.py`
- Create: `packages/authz/enstellar_authz/dependencies.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
# packages/authz/pyproject.toml
[project]
name = "enstellar-authz"
version = "0.1.0"
description = "Shared auth/tenancy middleware for Enstellar Python services"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.111",
    "pydantic>=2.9",
    "python-jose[cryptography]>=3.3",
    "httpx>=0.27",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
    "cryptography>=42",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["enstellar_authz"]
```

- [ ] **Step 2: Create enstellar_authz/exceptions.py**

```python
# packages/authz/enstellar_authz/exceptions.py
"""Auth exceptions — raised before any PHI-carrying context is set."""
from fastapi import HTTPException, status


class AuthError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


class ForbiddenError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class TenantMissingError(AuthError):
    def __init__(self) -> None:
        super().__init__("Token is missing required tenant_id claim")
```

- [ ] **Step 3: Create enstellar_authz/context.py**

```python
# packages/authz/enstellar_authz/context.py
"""TenantContext — thread/task-local context variable.

Every request handler that passes require_auth() will have tenant_id set
on the context var. Downstream code reads it via TenantContext.get().
No code should bypass this — queries without a tenant_id violate invariant #5.
"""
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    subject: str          # JWT `sub` claim
    scopes: frozenset[str]


_TENANT_CTX: ContextVar[TenantContext | None] = ContextVar("tenant_ctx", default=None)


def set_tenant_context(ctx: TenantContext) -> None:
    _TENANT_CTX.set(ctx)


def get_tenant_context() -> TenantContext:
    ctx = _TENANT_CTX.get()
    if ctx is None:
        raise RuntimeError(
            "TenantContext not set — this code path must be called inside a "
            "request that has passed require_auth()"
        )
    return ctx
```

- [ ] **Step 4: Create enstellar_authz/models.py**

```python
# packages/authz/enstellar_authz/models.py
"""Pydantic model for validated JWT claims."""
from pydantic import BaseModel, Field


class TokenClaims(BaseModel):
    sub: str
    iss: str
    aud: str | list[str] = Field(default_factory=list)
    exp: int
    iat: int
    tenant_id: str | None = None
    scope: str | None = None
    fhirUser: str | None = None
    email: str | None = None

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset((self.scope or "").split())
```

- [ ] **Step 5: Create enstellar_authz/jwt_validator.py**

```python
# packages/authz/enstellar_authz/jwt_validator.py
"""JWKS-based JWT validator.

Fetches Keycloak's public keys on first use and validates JWT signatures.
Caches JWKS in memory; refreshes after 5 minutes or on key-not-found.
"""
import time
from typing import Any

import httpx
from jose import ExpiredSignatureError, JWTError, jwk, jwt

from .exceptions import AuthError
from .models import TokenClaims


class JWTValidator:
    def __init__(
        self,
        jwks_uri: str,
        issuer: str,
        audience: str | None = None,
        *,
        cache_ttl_seconds: int = 300,
    ) -> None:
        self._jwks_uri = jwks_uri
        self._issuer = issuer
        self._audience = audience
        self._cache_ttl = cache_ttl_seconds
        self._jwks_cache: dict[str, Any] = {}
        self._cache_expires_at: float = 0.0

    def _fetch_jwks(self) -> dict[str, Any]:
        resp = httpx.get(self._jwks_uri, timeout=5.0)
        resp.raise_for_status()
        return resp.json()

    def _get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if force_refresh or now >= self._cache_expires_at:
            self._jwks_cache = self._fetch_jwks()
            self._cache_expires_at = now + self._cache_ttl
        return self._jwks_cache

    def validate(self, token: str) -> TokenClaims:
        """Validate a JWT bearer token and return its claims.

        Raises AuthError on any validation failure.
        """
        try:
            unverified_header = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise AuthError(f"Invalid token format: {exc}") from exc

        kid = unverified_header.get("kid")

        def _find_key(jwks: dict[str, Any]) -> Any:
            for key_data in jwks.get("keys", []):
                if kid is None or key_data.get("kid") == kid:
                    return jwk.construct(key_data)
            return None

        key = _find_key(self._get_jwks())
        if key is None:
            # kid not found — try refreshing once
            key = _find_key(self._get_jwks(force_refresh=True))
        if key is None:
            raise AuthError("Token signing key not found in JWKS")

        options: dict[str, Any] = {"verify_aud": self._audience is not None}
        try:
            payload = jwt.decode(
                token,
                key.to_dict(),
                algorithms=["RS256"],
                issuer=self._issuer,
                audience=self._audience,
                options=options,
            )
        except ExpiredSignatureError as exc:
            raise AuthError("Token has expired") from exc
        except JWTError as exc:
            raise AuthError(f"Token validation failed: {exc}") from exc

        return TokenClaims.model_validate(payload)
```

- [ ] **Step 6: Create enstellar_authz/dependencies.py**

```python
# packages/authz/enstellar_authz/dependencies.py
"""FastAPI dependency: require_auth().

Usage in a FastAPI app:
    from enstellar_authz.dependencies import require_auth, AuthedRequest

    @router.get("/cases")
    async def list_cases(auth: AuthedRequest) -> ...:
        ctx = auth  # TenantContext
        # ctx.tenant_id is always set here
"""
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .context import TenantContext, set_tenant_context
from .exceptions import AuthError, TenantMissingError
from .jwt_validator import JWTValidator

_bearer = HTTPBearer(auto_error=False)


def _get_validator(request: Request) -> JWTValidator:
    """Retrieve the JWTValidator registered on app.state by the service startup code."""
    validator: JWTValidator | None = getattr(request.app.state, "jwt_validator", None)
    if validator is None:
        raise RuntimeError(
            "jwt_validator not registered on app.state — add it in your app startup"
        )
    return validator


async def require_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    request: Request,
) -> TenantContext:
    """FastAPI dependency that validates the bearer token and sets TenantContext.

    Returns TenantContext so routes can declare it as a typed parameter.
    Raises 401 if token is absent or invalid, 403 if tenant_id is missing.
    """
    if credentials is None:
        raise AuthError("Missing Authorization header")

    validator = _get_validator(request)
    claims = validator.validate(credentials.credentials)

    if not claims.tenant_id:
        raise TenantMissingError()

    ctx = TenantContext(
        tenant_id=claims.tenant_id,
        subject=claims.sub,
        scopes=claims.scopes,
    )
    set_tenant_context(ctx)
    return ctx


AuthedRequest = Annotated[TenantContext, Depends(require_auth)]
```

- [ ] **Step 7: Create enstellar_authz/__init__.py**

```python
# packages/authz/enstellar_authz/__init__.py
"""Enstellar shared auth/tenancy package.

Import:
    from enstellar_authz.dependencies import AuthedRequest, require_auth
    from enstellar_authz.context import get_tenant_context
    from enstellar_authz.jwt_validator import JWTValidator
"""
from .context import TenantContext, get_tenant_context, set_tenant_context
from .dependencies import AuthedRequest, require_auth
from .exceptions import AuthError, ForbiddenError, TenantMissingError
from .jwt_validator import JWTValidator
from .models import TokenClaims

__all__ = [
    "AuthedRequest",
    "AuthError",
    "ForbiddenError",
    "JWTValidator",
    "TenantContext",
    "TenantMissingError",
    "TokenClaims",
    "get_tenant_context",
    "require_auth",
    "set_tenant_context",
]
```

- [ ] **Step 8: Install deps**

```bash
cd packages/authz && uv sync
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
rm packages/authz/.gitkeep
git add packages/authz/
git commit -m "feat(T03): enstellar_authz package — JWT validator + FastAPI dependency + TenantContext"
```

---

## Task 3: Python auth tests

**Files:**
- Create: `packages/authz/tests/conftest.py`
- Create: `packages/authz/tests/test_jwt_validator.py`
- Create: `packages/authz/tests/test_dependencies.py`

- [ ] **Step 1: Write failing test — run to confirm it fails**

Create `packages/authz/tests/conftest.py`:

```python
# packages/authz/tests/conftest.py
"""Shared fixtures for auth package tests."""
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
    pub_numbers = public_key.public_key().public_numbers() if hasattr(public_key, "public_key") else public_key.public_numbers()
    import base64, struct

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
) -> str:
    now = int(time.time())
    exp = now - 60 if expired else now + 3600
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(
        {
            "sub": sub,
            "iss": issuer,
            "iat": now,
            "exp": exp,
            "tenant_id": tenant_id,
            "scope": scope,
        },
        pem.decode(),
        algorithm="RS256",
        headers={"kid": kid},
    )
```

- [ ] **Step 2: Create test_jwt_validator.py**

```python
# packages/authz/tests/test_jwt_validator.py
"""Tests for JWTValidator.validate()."""
import pytest
import respx
import httpx

from enstellar_authz.exceptions import AuthError
from enstellar_authz.jwt_validator import JWTValidator
from .conftest import ISSUER, TENANT_ID, make_token


@pytest.fixture
def validator(jwks, rsa_key_pair):
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    with respx.mock:
        respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        # Pre-warm the cache
        v._get_jwks()
    return v, private_key


def test_valid_token_returns_claims(validator, jwks):
    v, private_key = validator
    token = make_token(private_key)
    with respx.mock:
        claims = v.validate(token)
    assert claims.tenant_id == TENANT_ID
    assert claims.sub == "user-123"
    assert "openid" in claims.scopes


def test_expired_token_raises(validator):
    v, private_key = validator
    token = make_token(private_key, expired=True)
    with pytest.raises(AuthError, match="expired"):
        v.validate(token)


def test_wrong_issuer_raises(validator):
    v, private_key = validator
    token = make_token(private_key, issuer="https://evil.example.com")
    with pytest.raises(AuthError):
        v.validate(token)


def test_malformed_token_raises(validator):
    v, _ = validator
    with pytest.raises(AuthError, match="Invalid token format"):
        v.validate("not.a.valid.jwt")


def test_unknown_kid_refreshes_and_raises(rsa_key_pair, jwks):
    private_key, _ = rsa_key_pair
    jwks_uri = "https://keycloak.local/realms/enstellar/protocol/openid-connect/certs"
    token = make_token(private_key, kid="unknown-kid")
    with respx.mock:
        respx.get(jwks_uri).mock(return_value=httpx.Response(200, json=jwks))
        v = JWTValidator(jwks_uri=jwks_uri, issuer=ISSUER)
        v._get_jwks()
        with pytest.raises(AuthError, match="signing key not found"):
            v.validate(token)
```

- [ ] **Step 3: Run test — expect all pass**

```bash
cd packages/authz && uv run pytest tests/test_jwt_validator.py -v
```

Expected:
```
PASSED tests/test_jwt_validator.py::test_valid_token_returns_claims
PASSED tests/test_jwt_validator.py::test_expired_token_raises
PASSED tests/test_jwt_validator.py::test_wrong_issuer_raises
PASSED tests/test_jwt_validator.py::test_malformed_token_raises
PASSED tests/test_jwt_validator.py::test_unknown_kid_refreshes_and_raises
```

- [ ] **Step 4: Create test_dependencies.py**

```python
# packages/authz/tests/test_dependencies.py
"""Tests for the FastAPI require_auth() dependency."""
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
            v._get_jwks()
        app.state.jwt_validator = v

    from enstellar_authz.dependencies import require_auth
    from fastapi import Depends
    from typing import Annotated

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
```

- [ ] **Step 5: Run all auth tests**

```bash
cd packages/authz && uv run pytest tests/ -v
```

Expected: all 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/authz/tests/
git commit -m "test(T03): enstellar_authz — JWT validation + FastAPI dependency tests green"
```

---

## Task 4: JVM interop skeleton — Spring Boot + Spring Security OAuth2

**Files:**
- Create: `services/interop/settings.gradle.kts`
- Create: `services/interop/build.gradle.kts`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantContext.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantInterceptor.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/config/SecurityConfig.java`
- Create: `services/interop/src/main/java/com/simintero/enstellar/interop/config/InterceptorConfig.java`
- Create: `services/interop/src/main/resources/application.yml`

- [ ] **Step 1: Create settings.gradle.kts**

```kotlin
// services/interop/settings.gradle.kts
rootProject.name = "interop"
```

- [ ] **Step 2: Create build.gradle.kts**

```kotlin
// services/interop/build.gradle.kts
plugins {
    java
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.5"
}

group = "com.simintero.enstellar"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.compilerArgs.add("-parameters")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")

    // HAPI FHIR R4
    implementation("ca.uhn.hapi.fhir:hapi-fhir-spring-boot-starter:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-server:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-structures-r4:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-jpaserver-base:7.4.0")

    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:junit-jupiter:1.19.8")
    testImplementation("org.testcontainers:postgresql:1.19.8")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
```

- [ ] **Step 3: Create application.yml**

```yaml
# services/interop/src/main/resources/application.yml
spring:
  application:
    name: interop
  security:
    oauth2:
      resourceserver:
        jwt:
          # Keycloak JWKS endpoint — matches local compose stack port.
          # Override via SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI in env.
          jwk-set-uri: ${KEYCLOAK_JWK_SET_URI:http://localhost:8081/realms/enstellar/protocol/openid-connect/certs}
          issuer-uri: ${KEYCLOAK_ISSUER_URI:http://localhost:8081/realms/enstellar}

hapi:
  fhir:
    fhir-version: R4
    rest:
      server-address: http://localhost:8080/fhir

server:
  port: 8080
```

- [ ] **Step 4: Create InteropApplication.java**

```java
// services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java
package com.simintero.enstellar.interop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class InteropApplication {
    public static void main(String[] args) {
        SpringApplication.run(InteropApplication.class, args);
    }
}
```

- [ ] **Step 5: Create TenantContext.java**

```java
// services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantContext.java
package com.simintero.enstellar.interop.auth;

/**
 * Thread-local tenant context. Set by TenantInterceptor for every authenticated request.
 * Every HAPI query must call TenantContext.require() — never query without it.
 */
public final class TenantContext {
    private static final ThreadLocal<String> TENANT_ID = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId must not be blank");
        }
        TENANT_ID.set(tenantId);
    }

    /** Returns the current tenant_id. Throws if not set (programming error). */
    public static String require() {
        var id = TENANT_ID.get();
        if (id == null) {
            throw new IllegalStateException(
                "TenantContext not set — all requests must pass auth and carry tenant_id"
            );
        }
        return id;
    }

    public static void clear() {
        TENANT_ID.remove();
    }
}
```

- [ ] **Step 6: Create TenantInterceptor.java**

```java
// services/interop/src/main/java/com/simintero/enstellar/interop/auth/TenantInterceptor.java
package com.simintero.enstellar.interop.auth;

import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Interceptor;
import ca.uhn.fhir.interceptor.api.Pointcut;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/**
 * HAPI interceptor that extracts tenant_id from the Spring Security JWT principal
 * and populates TenantContext for downstream query methods.
 *
 * Auth is enforced by Spring Security before HAPI processes the request.
 * This interceptor only handles the tenant context population.
 */
@Interceptor
@Component
public class TenantInterceptor {

    @Hook(Pointcut.SERVER_INCOMING_REQUEST_PRE_HANDLED)
    public void incomingRequest(RequestDetails requestDetails,
                                HttpServletRequest request,
                                HttpServletResponse response) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) {
            // Spring Security should have already rejected this — defensive only.
            return;
        }

        String tenantId = jwt.getClaimAsString("tenant_id");
        if (tenantId == null || tenantId.isBlank()) {
            throw new ca.uhn.fhir.rest.server.exceptions.AuthenticationException(
                "Token is missing required tenant_id claim"
            );
        }
        TenantContext.set(tenantId);
    }

    @Hook(Pointcut.SERVER_PROCESSING_COMPLETED_NORMALLY)
    public void afterRequest() {
        TenantContext.clear();
    }

    @Hook(Pointcut.SERVER_PROCESSING_COMPLETED)
    public void afterRequestOnError() {
        TenantContext.clear();
    }
}
```

- [ ] **Step 7: Create SecurityConfig.java**

```java
// services/interop/src/main/java/com/simintero/enstellar/interop/config/SecurityConfig.java
package com.simintero.enstellar.interop.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // SMART well-known — must be public per SMART on FHIR spec
                .requestMatchers(HttpMethod.GET, "/fhir/metadata").permitAll()
                .requestMatchers(HttpMethod.GET, "/.well-known/smart-configuration").permitAll()
                // Everything else requires a valid JWT
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> {})  // Uses spring.security.oauth2.resourceserver.jwt.* from application.yml
            )
            .build();
    }
}
```

- [ ] **Step 8: Create InterceptorConfig.java**

```java
// services/interop/src/main/java/com/simintero/enstellar/interop/config/InterceptorConfig.java
package com.simintero.enstellar.interop.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.server.RestfulServer;
import com.simintero.enstellar.interop.auth.TenantInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class InterceptorConfig {

    @Bean
    public RestfulServer restfulServer(FhirContext fhirContext, TenantInterceptor tenantInterceptor) {
        RestfulServer server = new RestfulServer(fhirContext);
        server.registerInterceptor(tenantInterceptor);
        return server;
    }
}
```

- [ ] **Step 9: Generate Gradle wrapper**

```bash
cd services/interop && gradle wrapper --gradle-version 8.7
```

Expected: `gradle/wrapper/`, `gradlew`, `gradlew.bat` created.

- [ ] **Step 10: Verify project builds (no run)**

```bash
cd services/interop && ./gradlew compileJava
```

Expected: `BUILD SUCCESSFUL`. Resolve any import errors before proceeding.

- [ ] **Step 11: Commit**

```bash
rm services/interop/.gitkeep
git add services/interop/
git commit -m "feat(T03): services/interop JVM skeleton — Spring Security OAuth2 + HAPI TenantInterceptor"
```

---

## Task 5: JVM security integration test

**Files:**
- Create: `services/interop/src/test/java/com/simintero/enstellar/interop/SecurityIntegrationTest.java`

- [ ] **Step 1: Write failing test**

```java
// services/interop/src/test/java/com/simintero/enstellar/interop/SecurityIntegrationTest.java
package com.simintero.enstellar.interop;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

/**
 * Verifies that Spring Security enforces JWT auth on FHIR endpoints.
 *
 * Does NOT start the full Keycloak container — uses MockMvc + Spring Security test
 * support to inject synthetic JWT principals. A full integration test against the
 * running Keycloak compose stack is added in T05 (when HAPI resources exist to query).
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    // Use a self-contained test config — no external Keycloak needed for this test.
    "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=https://example.com/.well-known/jwks.json",
    "spring.security.oauth2.resourceserver.jwt.issuer-uri="
})
class SecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void metadataEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/fhir/metadata"))
               .andExpect(status().isOk());
    }

    @Test
    void protectedEndpointWithoutTokenReturns401() throws Exception {
        mockMvc.perform(get("/fhir/Patient"))
               .andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointWithValidJwtReturns200OrNotFound() throws Exception {
        // A valid JWT with tenant_id should be accepted by Spring Security.
        // The actual HAPI resource response (404 / empty bundle) comes in T05.
        mockMvc.perform(get("/fhir/Patient")
                   .with(jwt().jwt(j -> j
                       .claim("tenant_id", "tenant-test")
                       .claim("sub", "user-123"))))
               .andExpect(result -> {
                   int status = result.getResponse().getStatus();
                   // Accept 200 (empty bundle), 404 (no patients yet), or 501 (not implemented in skeleton)
                   assert status != 401 && status != 403
                       : "Expected non-auth failure but got " + status;
               });
    }
}
```

- [ ] **Step 2: Run test — expect it to fail first (class not found or config error)**

```bash
cd services/interop && ./gradlew test --tests SecurityIntegrationTest 2>&1 | tail -30
```

Note the error. The test will likely fail because the HAPI FHIR Spring Boot starter expects a DataSource. Fix by adding an H2 in-memory DB for testing:

Add to `build.gradle.kts` testImplementation block:
```kotlin
testImplementation("com.h2database:h2")
```

And create `src/test/resources/application-test.yml`:
```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
  jpa:
    hibernate:
      ddl-auto: create-drop
    properties:
      hibernate:
        dialect: org.hibernate.dialect.H2Dialect
```

Annotate the test class: `@ActiveProfiles("test")`.

- [ ] **Step 3: Run test — expect all 3 pass**

```bash
cd services/interop && ./gradlew test
```

Expected: `BUILD SUCCESSFUL`, `3 tests passed`.

- [ ] **Step 4: Commit**

```bash
git add services/interop/src/test/ services/interop/src/test/resources/ services/interop/build.gradle.kts
git commit -m "test(T03): JVM Spring Security — auth enforcement tests green; /fhir/metadata public, /fhir/* requires JWT"
```

---

## Task 6: Wire tests + update CI + task graph

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 1: Add authz test targets to Makefile**

Append to the `test:` target in `Makefile`:

```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd packages/authz && uv run pytest tests/ -v
	cd services/interop && ./gradlew test
```

- [ ] **Step 2: Add CI jobs to .github/workflows/ci.yml**

```yaml
  test-authz-python:
    name: Auth package — Python tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Test
        working-directory: packages/authz
        run: |
          uv sync
          uv run pytest tests/ -v

  test-interop-security:
    name: services/interop — security tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"
      - name: Test
        working-directory: services/interop
        run: ./gradlew test
```

- [ ] **Step 3: Update task-graph.md**

Mark T03 as in-progress `[~]` (not `[x]` — requires senior engineer review before marking done):

```markdown
| T03 identity/authz (Keycloak, SMART) | JVM+Py | T01 | **sensitive (auth)** | `[~]` |
```

- [ ] **Step 4: Run full make test**

```bash
make test
```

Expected: all targets pass.

- [ ] **Step 5: Commit**

```bash
git add Makefile .github/workflows/ci.yml .claude/task-graph.md
git commit -m "feat(T03): wire auth tests into Makefile + CI — awaiting senior engineer review to mark done"
```

---

## Self-Check

- [x] Keycloak realm imports cleanly (`--import-realm` in docker-compose)
- [x] `tenant_id` custom claim mapper configured in realm JSON
- [x] Test client with `client_secret` (for CI integration tests only — not used in production)
- [x] Python: JWT validation uses JWKS (no shared secret); cache + refresh on key-not-found
- [x] Python: `tenant_id` missing from token → 401 (not 403) — `TenantMissingError extends AuthError`
- [x] Python: `TenantContext` uses `ContextVar` (async-safe)
- [x] JVM: `/fhir/metadata` is explicitly permitted without auth (SMART well-known requirement)
- [x] JVM: Spring Security OAuth2 Resource Server validates JWT; `TenantInterceptor` extracts `tenant_id`
- [x] JVM: `TenantContext.clear()` called in both normal and error HAPI pointcuts (no context leak)
- [x] No PHI in test data (synthetic only)
- [x] T03 marked `[~]` in task graph — must not be marked done until senior engineer review
- [x] Senior engineer review gate noted prominently at top of plan
