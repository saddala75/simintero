from __future__ import annotations
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal
from pydantic import BaseModel, Field

PrincipalType = Literal["human", "service", "model_agent"]
Tier = Literal["pooled", "dedicated", "enclave"]

class Scopes(BaseModel):
    lob: list[str] = Field(default_factory=list)
    region: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)

class TenantContext(BaseModel):
    tenant_id: str
    cell_id: str = ""
    tier: Tier = "pooled"
    scopes: Scopes = Field(default_factory=Scopes)
    roles: list[str] = Field(default_factory=list)
    principal_type: PrincipalType = "service"

_current: ContextVar[TenantContext | None] = ContextVar("sim_tenant_ctx", default=None)

def set_context(ctx: TenantContext):
    """Set the current tenant context and return the reset token.

    Prefer `tenant_context(...)` (scoped) for request handling. This bare setter
    is for adapters that manage the token lifecycle themselves; the caller is
    responsible for calling `_current.reset(token)`.
    """
    return _current.set(ctx)

@contextmanager
def tenant_context(ctx: TenantContext):
    """Scoped tenant context — sets on enter, ALWAYS resets on exit.

    Mirrors the TS `withTenantContext`: prevents a stale context leaking into the
    next unit of work on a reused task.
    """
    token = _current.set(ctx)
    try:
        yield ctx
    finally:
        _current.reset(token)

def get_context() -> TenantContext:
    ctx = _current.get()
    if ctx is None:
        raise RuntimeError(
            "No tenant context: a context-requiring scope was reached without x-sim-ctx. "
            "Apply the tenant-context dependency before this handler."
        )
    return ctx
