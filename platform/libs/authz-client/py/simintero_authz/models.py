from pydantic import BaseModel, ConfigDict, Field


class TokenClaims(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

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
    # ponytail: alias captures flat 'roles' from roles_flat_mapper; realm_access.roles is preferred when present
    flat_roles: list[str] = Field(default_factory=list, alias="roles")
    azp: str | None = None
    typ: str | None = None
    principal_type: str | None = None

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset((self.scope or "").split())

    @property
    def roles(self) -> list[str]:
        realm_roles = list((self.realm_access or {}).get("roles", []))
        return realm_roles if realm_roles else self.flat_roles
