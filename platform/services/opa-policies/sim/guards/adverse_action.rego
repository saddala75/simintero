package sim.guards.adverse_action

import rego.v1

adverse_outcomes := {"deny", "partial_deny", "modify"}

sign_off_roles := {"medical_director"}

# Non-adverse outcomes are not guarded by this policy
allow if {
  input.action == "decision.record"
  not input.resource.outcome in adverse_outcomes
}

# Adverse outcomes require a human with clinical sign-off role, rationale, and trace
allow if {
  input.action == "decision.record"
  input.resource.outcome in adverse_outcomes
  input.principal.sim.principal_type == "human"
  some role in sign_off_roles
  role in input.principal.sim.roles
  count(input.resource.rationale) > 0
  count(input.resource.trace_ref) > 0
}
