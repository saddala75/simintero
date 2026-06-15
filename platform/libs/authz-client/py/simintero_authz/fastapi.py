from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from simintero_tenant_context import TenantContext, set_context

from .context import tenant_context_from_claims
from .errors import AuthError
from .jwt_validator import JWTValidator

_bearer = HTTPBearer(auto_error=False)


def make_require_auth(validator: JWTValidator):
    """Build a FastAPI dependency: validate the bearer JWT, derive the
    TenantContext, set it in the contextvar, return (context, raw_token)."""

    async def require_auth(
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> tuple[TenantContext, str]:
        if creds is None:
            raise AuthError("Missing Authorization header")
        claims = await validator.validate(creds.credentials)
        tid = (claims.tenant_id or "").strip()
        if not tid:
            raise AuthError("Token missing tenant_id")
        ctx = tenant_context_from_claims(claims)
        set_context(ctx)
        return ctx, creds.credentials

    return require_auth
