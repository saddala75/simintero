"""portal-bff authentication.

portal-bff is a stateless proxy BFF. It adopts ``simintero-authz`` to validate
the Keycloak JWT (realm ``simintero``) and derive a platform ``TenantContext``,
but it does NOT open a DB transaction (no ``tenant_transaction``) — it forwards
the raw bearer downstream to the workflow-engine.

The public dependency is ``require_reviewer``: it validates the JWT, scopes the
tenant context for the request, enforces the ``reviewer`` realm role (403 if
absent), and yields ``(ctx, bearer)`` where ``ctx`` is a ``TenantContext``
carrying the JWT ``sub`` and ``bearer`` is the raw token forwarded downstream.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from simintero_authz import AuthError, ForbiddenError, JWTValidator
from simintero_authz.context import tenant_context_from_claims
from simintero_authz.fastapi import make_require_auth
from simintero_tenant_context import TenantContext, tenant_context

from enstellar_bff.config import settings

REVIEWER_ROLE = "reviewer"

_bearer = HTTPBearer(auto_error=False)


class BffContext(TenantContext):
    """TenantContext extended with the JWT ``sub``.

    The platform TenantContext intentionally omits ``sub``; the BFF needs it to
    stamp ``actor_id``/``reviewer_id`` on downstream calls (a non-negotiable
    security invariant — these are never accepted from the request body).
    """

    sub: str = ""


# Singleton JWT validator (JWKS fetch + TTL cache live on the instance).
validator = JWTValidator(
    jwks_uri=settings.keycloak_jwks_url,
    issuer=settings.oidc_issuer,
    audience=settings.oidc_audience,
)

# Base dependency from simintero-authz: validates the JWT, derives the
# TenantContext, scopes it (auto-reset on teardown), yields (ctx, raw_token).
# Exposed for routes/tests that need identity without the reviewer-role gate.
require_auth = make_require_auth(validator)


async def require_reviewer(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[tuple[BffContext, str]]:
    """Validate the bearer JWT, scope the tenant context, enforce the reviewer
    role, and yield ``(BffContext, bearer)``.

    Mirrors ``simintero_authz.fastapi.make_require_auth`` (validate → derive →
    scope → yield) and adds the BFF's reviewer-role gate plus ``sub`` recovery.

    Raises:
        ``AuthError``     → 401 (token absent, malformed, expired, or no tenant_id)
        ``ForbiddenError`` → 403 (reviewer role absent)
    """
    if creds is None:
        raise AuthError("Missing Authorization header")
    claims = await validator.validate(creds.credentials)
    tid = (claims.tenant_id or "").strip()
    if not tid:
        raise AuthError("Token missing tenant_id")
    if REVIEWER_ROLE not in claims.roles:
        raise ForbiddenError("reviewer role required")
    base = tenant_context_from_claims(claims)
    ctx = BffContext(**base.model_dump(), sub=claims.sub)
    with tenant_context(ctx):  # sets on enter, ALWAYS resets on exit
        yield ctx, creds.credentials


async def require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[tuple[BffContext, str]]:
    """Validate the JWT + carry the ``sub`` (NO role gate). For routes where any
    authenticated user acts but we must record WHO (e.g. filing).

    Mirrors ``require_reviewer`` minus the reviewer-role gate: it additionally
    requires a non-empty ``sub`` so the BFF can stamp ``filed_by`` from the
    authenticated identity (never from the request body).

    Raises:
        ``AuthError`` → 401 (token absent, malformed, expired, no tenant_id, no sub)
    """
    if creds is None:
        raise AuthError("Missing Authorization header")
    claims = await validator.validate(creds.credentials)
    tid = (claims.tenant_id or "").strip()
    if not tid:
        raise AuthError("Token missing tenant_id")
    if not (claims.sub or "").strip():
        raise AuthError("Token missing sub")
    base = tenant_context_from_claims(claims)
    ctx = BffContext(**base.model_dump(), sub=claims.sub)
    with tenant_context(ctx):  # sets on enter, ALWAYS resets on exit
        yield ctx, creds.credentials


__all__ = [
    "require_reviewer",
    "require_auth",
    "require_user",
    "validator",
    "BffContext",
]
