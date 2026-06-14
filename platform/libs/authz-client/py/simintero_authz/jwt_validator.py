"""Keycloak JWT (RS256/JWKS) validator for realm ``simintero``.

Ported faithfully from Enstellar's proven validator: JWKS fetch + TTL cache +
force-refresh cooldown + asyncio lock, RS256 only, issuer + audience
enforcement, and rejection of tokens that omit the ``aud`` claim entirely.
"""

import asyncio
import time
from typing import Any

import httpx
from jose import ExpiredSignatureError, JWTError, jwk, jwt

from .errors import AuthError
from .models import TokenClaims

# Minimum interval between force-refreshes of the JWKS cache.  A burst of
# tokens with unknown/rotated keys must not trigger unbounded HTTP calls to
# the Keycloak JWKS endpoint.
FORCE_REFRESH_COOLDOWN_SECONDS = 60


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
        # Tracks when we last performed a force-refresh so we can enforce the
        # cooldown.  Initialised to 0.0 so the very first force-refresh is
        # always allowed.
        self._last_force_refresh_at: float = 0.0
        # Guards the force-refresh read-then-write against concurrent coroutines.
        self._refresh_lock = asyncio.Lock()

    async def _fetch_jwks(self) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(self._jwks_uri, timeout=5.0)
        resp.raise_for_status()
        return resp.json()

    async def _get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if force_refresh:
            # Acquire the lock so that concurrent force-refreshes don't produce
            # a burst of HTTP calls.  Re-read the timestamp inside the lock to
            # handle the case where another coroutine completed a refresh while
            # this one was waiting.
            async with self._refresh_lock:
                now = time.monotonic()
                if now - self._last_force_refresh_at <= FORCE_REFRESH_COOLDOWN_SECONDS:
                    # Within cooldown window — return the cached data without
                    # hitting Keycloak again.  The caller will find the key
                    # absent and raise AuthError, which is the correct behaviour.
                    return self._jwks_cache
                jwks = await self._fetch_jwks()
                self._cache_expires_at = time.monotonic() + self._cache_ttl
                self._last_force_refresh_at = time.monotonic()
                self._jwks_cache = jwks
                return jwks
        elif now >= self._cache_expires_at:
            self._jwks_cache = await self._fetch_jwks()
            self._cache_expires_at = now + self._cache_ttl
        return self._jwks_cache

    async def validate(self, token: str) -> TokenClaims:
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

        key = _find_key(await self._get_jwks())
        if key is None:
            key = _find_key(await self._get_jwks(force_refresh=True))
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

        # python-jose 3.x does not raise when verify_aud=True but the token
        # carries no aud claim at all (it only checks claim value when present).
        # Enforce the invariant ourselves: if we expect an audience, the claim
        # MUST exist in the token.
        if self._audience is not None and not payload.get("aud"):
            raise AuthError("Token is missing required aud claim")

        return TokenClaims.model_validate(payload)
