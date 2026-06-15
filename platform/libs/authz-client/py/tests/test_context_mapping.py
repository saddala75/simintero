from simintero_authz import TokenClaims, tenant_context_from_claims


def test_maps_roles_and_tenant():
    claims = TokenClaims(sub="u1", iss="i", exp=9999999999, iat=1,
                         tenant_id="t_acme", realm_access={"roles": ["medical_director"]})
    ctx = tenant_context_from_claims(claims)
    assert ctx.tenant_id == "t_acme"
    assert ctx.roles == ["medical_director"]
    assert ctx.principal_type == "human"


def test_explicit_principal_type_honored():
    claims = TokenClaims(sub="svc", iss="i", exp=9999999999, iat=1,
                         tenant_id="t_acme", principal_type="service")
    assert tenant_context_from_claims(claims).principal_type == "service"
