from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .context import TenantContext, set_tenant_context
from .exceptions import AuthError, TenantMissingError
from .jwt_validator import JWTValidator

_bearer = HTTPBearer(auto_error=False)


def validate_jwt_config(validator: JWTValidator) -> None:
    """Assert that the validator is fully configured for production use.

    Call this once during app startup (e.g. in a FastAPI lifespan handler)
    to fail fast if the expected audience is not configured.  An absent
    audience means the ``aud`` claim in incoming JWTs is never verified —
    a token issued for a different service would be accepted.

    Raises:
        RuntimeError: if ``audience`` was not set on the validator.
    """
    if validator._audience is None:
        raise RuntimeError(
            "JWTValidator has no expected audience configured. "
            "Set the EXPECTED_AUDIENCE environment variable and pass it as "
            "audience= when constructing JWTValidator. "
            "Without this the aud claim is not verified and tokens issued "
            "for other services will be accepted."
        )


def _get_validator(request: Request) -> JWTValidator:
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
    if credentials is None:
        raise AuthError("Missing Authorization header")

    validator = _get_validator(request)
    claims = await validator.validate(credentials.credentials)

    # Strip whitespace before checking — a claim of "   " must be treated
    # the same as a missing claim (invariant #5: tenant scope must be real).
    tenant_id = (claims.tenant_id or "").strip()
    if not tenant_id:
        raise TenantMissingError()

    ctx = TenantContext(
        tenant_id=tenant_id,
        subject=claims.sub,
        scopes=claims.scopes,
    )
    set_tenant_context(ctx)
    return ctx


AuthedRequest = Annotated[TenantContext, Depends(require_auth)]
