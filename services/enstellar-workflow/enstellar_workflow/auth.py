"""Auth wiring for the workflow engine — adopts the platform `simintero-authz`.

Constructs a single Keycloak JWT validator (realm ``simintero``) and the
``make_require_auth`` FastAPI dependency. The dependency validates the bearer
token, derives a platform ``TenantContext`` from the claims, scopes that context
for the request (auto-reset on teardown) and yields ``(ctx, raw_token)``.

Routers depend on ``AuthedRequest`` (a thin wrapper that returns just the
``TenantContext``) so existing handlers keep reading ``auth.tenant_id``.
Tests override the underlying ``require_auth`` dependency.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from simintero_authz import JWTValidator
from simintero_authz.fastapi import make_require_auth
from simintero_tenant_context import TenantContext

from .config import get_settings

_settings = get_settings()

# Constructed once at import (app startup). JWTValidator only stores config here;
# the JWKS endpoint is fetched lazily on the first token validation.
jwt_validator = JWTValidator(
    jwks_uri=_settings.keycloak_jwks_url,
    issuer=_settings.oidc_issuer,
    audience=_settings.oidc_audience,
)

# The make_require_auth dependency: yields (TenantContext, raw_token) and scopes
# the tenant context for the duration of the request.
require_auth = make_require_auth(jwt_validator)


async def _require_ctx(
    auth: Annotated[tuple[TenantContext, str], Depends(require_auth)],
) -> TenantContext:
    """Unwrap the (ctx, token) tuple, returning just the scoped TenantContext."""
    ctx, _token = auth
    return ctx


# Drop-in replacement for the old per-service AuthedRequest annotation —
# handlers receive a TenantContext and read `auth.tenant_id` unchanged.
AuthedRequest = Annotated[TenantContext, Depends(_require_ctx)]
