import json

import httpx
import pytest
import respx
from simintero_authz.opa import authorize
from simintero_authz.errors import ForbiddenError

PRINCIPAL = {"tenant_id": "t_acme", "roles": ["medical_director"], "principal_type": "human"}


@respx.mock
@pytest.mark.asyncio
async def test_allows_when_opa_result_true():
    route = respx.post("http://opa:8181/v1/data/sim/guards/adverse_action/allow").mock(
        return_value=httpx.Response(200, json={"result": True})
    )
    await authorize({"action": "decision.record", "resource": {"outcome": "denied"}},
                    principal=PRINCIPAL, opa_url="http://opa:8181")
    payload = json.loads(route.calls.last.request.content)
    assert payload["input"]["principal"]["sim"] == PRINCIPAL


@respx.mock
@pytest.mark.asyncio
async def test_denies_when_opa_result_false():
    respx.post("http://opa:8181/v1/data/sim/guards/adverse_action/allow").mock(
        return_value=httpx.Response(200, json={"result": False})
    )
    with pytest.raises(ForbiddenError) as ei:
        await authorize({"action": "decision.record", "resource": {}},
                        principal=PRINCIPAL, opa_url="http://opa:8181")
    assert ei.value.code == "SIM-AUTHZ-0001"
