package sim.guards.adverse_action_test

import data.sim.guards.adverse_action

test_allows_medical_director_human_with_rationale {
  adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": {
        "principal_type": "human",
        "roles": ["medical_director"],
        "tenant_id": "t_test"
      }
    },
    "resource": {
      "outcome": "deny",
      "region": "TX",
      "rationale": "criteria not met per CMS LCD L34021",
      "trace_ref": "trc_01JTEST"
    }
  }
}

test_denies_service_principal {
  not adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": {
        "principal_type": "service",
        "roles": ["medical_director"],
        "tenant_id": "t_test"
      }
    },
    "resource": {
      "outcome": "deny",
      "region": "TX",
      "rationale": "x",
      "trace_ref": "trc_01J"
    }
  }
}

test_denies_model_agent {
  not adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": {
        "principal_type": "model_agent",
        "roles": ["medical_director"],
        "tenant_id": "t_test"
      }
    },
    "resource": {
      "outcome": "deny",
      "region": "TX",
      "rationale": "x",
      "trace_ref": "trc_01J"
    }
  }
}

test_denies_missing_rationale {
  not adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": { "principal_type": "human", "roles": ["medical_director"] }
    },
    "resource": {
      "outcome": "deny",
      "region": "TX",
      "rationale": "",
      "trace_ref": "trc_01J"
    }
  }
}

test_denies_missing_trace_ref {
  not adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": { "principal_type": "human", "roles": ["medical_director"] }
    },
    "resource": {
      "outcome": "deny",
      "region": "TX",
      "rationale": "x",
      "trace_ref": ""
    }
  }
}

test_allows_non_adverse_outcomes_for_service {
  adverse_action.allow with input as {
    "action": "decision.record",
    "principal": {
      "sim": { "principal_type": "service", "roles": ["workflow_engine"] }
    },
    "resource": {
      "outcome": "approve",
      "region": "TX",
      "rationale": "auto-approved",
      "trace_ref": "trc_01J"
    }
  }
}
