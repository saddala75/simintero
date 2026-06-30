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

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from simintero_authz import AuthError, ForbiddenError, JWTValidator
from simintero_authz.context import tenant_context_from_claims
from simintero_authz.fastapi import make_require_auth
from simintero_tenant_context import TenantContext, tenant_context

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


# ---------------------------------------------------------------------------
# Role-gated reviewer/assigner deps (P2 — appeals reviewer identity).
#
# Mirrors the proven portal-bff ``require_reviewer`` pattern: validate the JWT,
# enforce a realm role, recover the ``sub`` (authenticated user id) and scope the
# tenant context for the request. Appeal decisions stamp the reviewer actor from
# ``ReviewerContext.sub`` — NEVER from the (untrusted) request body.
# ---------------------------------------------------------------------------
REVIEWER_ROLE = "reviewer"
# Configurable; matches the Keycloak ``simintero`` realm role for the people who
# assign appeal cases to reviewers.
APPEALS_ASSIGNER_ROLE = "appeals_coordinator"
# Matches the Keycloak ``simintero`` realm role for the people who acknowledge
# grievances and assign investigators (P5).
GRIEVANCE_COORDINATOR_ROLE = "grievance_coordinator"

_bearer = HTTPBearer(auto_error=False)


class ReviewerContext(TenantContext):
    """TenantContext + the JWT ``sub`` (the authenticated user id).

    The platform TenantContext intentionally omits ``sub``; appeal decisions
    stamp ``reviewer_actor`` from it, NEVER from the request body.
    """

    sub: str = ""


async def _authed_with_role(
    creds: HTTPAuthorizationCredentials | None, required_role: str
) -> ReviewerContext:
    """Validate the bearer JWT, enforce ``required_role`` and return a scoped
    ``ReviewerContext`` carrying the JWT ``sub``.

    Raises:
        ``AuthError``      → token absent, or missing tenant_id / sub.
        ``ForbiddenError`` → required role absent from the token.
    """
    if creds is None:
        raise AuthError("Missing Authorization header")
    claims = await jwt_validator.validate(creds.credentials)
    tid = (claims.tenant_id or "").strip()
    if not tid:
        raise AuthError("Token missing tenant_id")
    # The sub is the reviewer identity stamped on appeal decisions + matched by
    # the assignment gate; a blank sub must never reach those (it could otherwise
    # match a blank assigned_to and slip the gate).
    if not (claims.sub or "").strip():
        raise AuthError("Token missing sub")
    if required_role not in claims.roles:
        raise ForbiddenError(f"{required_role} role required")
    base = tenant_context_from_claims(claims)
    return ReviewerContext(**base.model_dump(), sub=claims.sub)


async def require_reviewer(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[ReviewerContext]:
    """Enforce the ``reviewer`` role; yield a scoped ``ReviewerContext``."""
    ctx = await _authed_with_role(creds, REVIEWER_ROLE)
    request.state.tenant_context = ctx  # for OTel middleware
    with tenant_context(ctx):  # sets on enter, ALWAYS resets on exit
        yield ctx


async def require_appeals_assigner(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[ReviewerContext]:
    """Enforce the ``appeals_coordinator`` role; yield a scoped ``ReviewerContext``."""
    ctx = await _authed_with_role(creds, APPEALS_ASSIGNER_ROLE)
    request.state.tenant_context = ctx  # for OTel middleware
    with tenant_context(ctx):  # sets on enter, ALWAYS resets on exit
        yield ctx


async def require_grievance_coordinator(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[ReviewerContext]:
    """Enforce the ``grievance_coordinator`` role; yield a scoped ``ReviewerContext``."""
    ctx = await _authed_with_role(creds, GRIEVANCE_COORDINATOR_ROLE)
    request.state.tenant_context = ctx  # for OTel middleware
    with tenant_context(ctx):  # sets on enter, ALWAYS resets on exit
        yield ctx


ReviewerRequest = Annotated[ReviewerContext, Depends(require_reviewer)]
AssignerRequest = Annotated[ReviewerContext, Depends(require_appeals_assigner)]
GrievanceCoordinatorRequest = Annotated[
    ReviewerContext, Depends(require_grievance_coordinator)
]

# ---------------------------------------------------------------------------
# Saas admin role — platform-wide admin operations (DLQ, etc.)
# ---------------------------------------------------------------------------
SAAS_ADMIN_ROLE = "saas_admin"


async def require_saas_admin(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[ReviewerContext]:
    """Enforce the saas_admin role; yield a scoped ReviewerContext."""
    ctx = await _authed_with_role(creds, SAAS_ADMIN_ROLE)
    request.state.tenant_context = ctx
    with tenant_context(ctx):
        yield ctx


AdminRequest = Annotated[ReviewerContext, Depends(require_saas_admin)]
