from pydantic import BaseModel, Field


class TokenClaims(BaseModel):
    sub: str
    iss: str
    aud: str | list[str] = Field(default_factory=list)
    exp: int
    iat: int
    tenant_id: str | None = None
    scope: str | None = None
    fhirUser: str | None = None
    email: str | None = None
    realm_access: dict | None = None
    azp: str | None = None
    typ: str | None = None
    principal_type: str | None = None

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset((self.scope or "").split())

    @property
    def roles(self) -> list[str]:
        return list((self.realm_access or {}).get("roles", []))
