from __future__ import annotations

import os
from typing import Any

import httpx

from .errors import ForbiddenError

DEFAULT_POLICY = "sim/guards/adverse_action/allow"


async def authorize(
    inp: dict[str, Any],
    *,
    principal: dict[str, Any],
    policy: str = DEFAULT_POLICY,
    opa_url: str | None = None,
    timeout_s: float = 2.0,
) -> None:
    """Raise ForbiddenError unless OPA returns result == true.

    `principal` must carry tenant_id/roles/principal_type; it is nested under
    input.principal.sim to match the platform Rego + the TS authz-client.
    """
    base = opa_url or os.environ.get("OPA_URL", "http://localhost:8181")
    payload = {"input": {**inp, "principal": {"sim": principal}}}
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(f"{base}/v1/data/{policy}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"OPA unreachable: {resp.status_code}")
    if resp.json().get("result") is not True:
        raise ForbiddenError()
