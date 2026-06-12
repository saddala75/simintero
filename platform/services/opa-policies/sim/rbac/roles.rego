package sim.rbac

import rego.v1

# Role definitions — managed as VKAS artifacts in production.
# These are the seed roles for Phase 0.
roles := {
  "medical_director": {
    "permissions": ["decision.record", "case.read", "case.write", "trace.read"]
  },
  "um_nurse_reviewer": {
    "permissions": ["case.read", "case.write", "trace.read"]
  },
  "workflow_engine": {
    "permissions": ["case.read", "case.write", "case.state.transition", "decision.record"]
  },
  "saas_admin": {
    "permissions": ["tenant.read", "tenant.write", "entitlement.read", "entitlement.write"]
  }
}

# A principal has a permission if any of their roles grants it
has_permission(principal, permission) if {
  some role in principal.sim.roles
  some granted in roles[role].permissions
  granted == permission
}
