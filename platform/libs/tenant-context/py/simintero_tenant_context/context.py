from __future__ import annotations
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

def set_context(ctx: TenantContext) -> None:
    _current.set(ctx)

def get_context() -> TenantContext:
    ctx = _current.get()
    if ctx is None:
        raise RuntimeError(
            "No tenant context: a context-requiring scope was reached without x-sim-ctx. "
            "Apply the tenant-context dependency before this handler."
        )
    return ctx
