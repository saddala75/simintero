import pytest
from simintero_tenant_context import TenantContext, tenant_context, get_context, set_context

def test_get_context_raises_when_unset():
    with pytest.raises(RuntimeError):
        get_context()

def test_scoped_context_sets_and_resets():
    ctx = TenantContext(tenant_id="t_acme", roles=["um_nurse_reviewer"], principal_type="human")
    with tenant_context(ctx):
        assert get_context().tenant_id == "t_acme"
        assert get_context().principal_type == "human"
    # after the scope exits, context MUST be cleared again
    with pytest.raises(RuntimeError):
        get_context()

def test_scoped_context_resets_even_on_exception():
    ctx = TenantContext(tenant_id="t_x")
    with pytest.raises(ValueError):
        with tenant_context(ctx):
            raise ValueError("boom")
    with pytest.raises(RuntimeError):
        get_context()

def test_bare_set_context_returns_token_for_manual_reset():
    import simintero_tenant_context.context as m
    tok = set_context(TenantContext(tenant_id="t_y"))
    assert get_context().tenant_id == "t_y"
    m._current.reset(tok)
    with pytest.raises(RuntimeError):
        get_context()
