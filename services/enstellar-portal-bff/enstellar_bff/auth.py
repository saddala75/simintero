from __future__ import annotations

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
import httpx

from enstellar_bff.config import settings

bearer = HTTPBearer(auto_error=False)
_jwks_cache: dict[str, object] = {}


async def _load_jwks() -> dict:
    if not _jwks_cache:
        async with httpx.AsyncClient() as c:
            r = await c.get(settings.keycloak_jwks_url)
            r.raise_for_status()
            _jwks_cache.update(r.json())
    return _jwks_cache


async def require_reviewer(
    creds: HTTPAuthorizationCredentials | None = Security(bearer),
) -> dict:
    """Validate Bearer JWT; extract tenant_id and roles; enforce reviewer role.

    Returns: {"tenant_id": str, "roles": list[str], "sub": str, "bearer_token": str}
    Raises:
        401 — token absent, malformed, or expired
        403 — missing tenant_id claim or reviewer role absent
    """
    if creds is None:
        raise HTTPException(status_code=401, detail="missing authorization header")

    try:
        jwks = await _load_jwks()
        payload = jwt.decode(creds.credentials, jwks, algorithms=["RS256"])
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid token")

    tenant_id: str | None = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="missing tenant_id claim")

    roles: list[str] = payload.get("roles", [])
    if "reviewer" not in roles:
        raise HTTPException(status_code=403, detail="reviewer role required")

    return {
        "tenant_id": tenant_id,
        "roles": roles,
        "sub": payload["sub"],
        "bearer_token": f"Bearer {creds.credentials}",
    }
