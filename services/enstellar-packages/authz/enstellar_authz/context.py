from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    subject: str
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
