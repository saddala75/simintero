"""Client for the interop CRD (CDS Hooks) surface."""
import httpx

from enstellar_bff.config import settings


class CrdClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")

    async def invoke(self, hook_id: str, body: dict, tenant_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self._base}/{hook_id}",
                json=body,
                headers={"X-Tenant-Id": tenant_id},
                timeout=15.0,
            )
            r.raise_for_status()
            return r.json()


crd_client = CrdClient(settings.crd_api_url)
