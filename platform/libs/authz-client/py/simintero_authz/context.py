from __future__ import annotations

from simintero_tenant_context import Scopes, TenantContext

from .models import TokenClaims


def tenant_context_from_claims(claims: TokenClaims) -> TenantContext:
    """Derive a platform TenantContext from a validated Keycloak JWT (the C2
    'derive from JWT' decision). cell_id/tier/scopes default — carried by the
    signed x-sim-ctx token in Section D."""
    principal_type = claims.principal_type or "human"
    return TenantContext(
        tenant_id=claims.tenant_id or "",
        roles=claims.roles,
        principal_type=principal_type,
        scopes=Scopes(),
        cell_id="",
        tier="pooled",
    )
