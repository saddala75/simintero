package sim.automation_test

import data.sim.automation

# Test: approve allowed when all conditions met (confidence must be exactly 1.0 since threshold is 1.0)
test_allow_when_all_conditions_met if {
    automation.allow with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}

# Test: deny when classification is not advisory
test_deny_when_not_advisory if {
    not automation.allow with input as {
        "classification": "clinical",
        "confidence": 1.0,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
    automation.deny_reasons["classification_not_advisory"] with input as {
        "classification": "clinical",
        "confidence": 1.0,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}

# Test: deny when confidence below threshold
test_deny_when_confidence_below_threshold if {
    not automation.allow with input as {
        "classification": "advisory",
        "confidence": 0.99,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
    automation.deny_reasons["confidence_below_threshold"] with input as {
        "classification": "advisory",
        "confidence": 0.99,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}

# Test: deny when proposed outcome is 'deny'
test_deny_when_outcome_is_deny if {
    not automation.allow with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "deny",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
    automation.deny_reasons["adverse_outcome_blocked"] with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "deny",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}

# Test: deny when proposed outcome is 'modify'
test_deny_when_outcome_is_modify if {
    not automation.allow with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "modify",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
    automation.deny_reasons["adverse_outcome_blocked"] with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "modify",
        "entitlements": {"ai.automation.live": true}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}

# Test: deny when automation not enabled in entitlements
test_deny_when_automation_not_enabled if {
    not automation.allow with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": false}
    } with data.sim.automation_config as {"min_confidence": 1.0}
    automation.deny_reasons["automation_not_enabled"] with input as {
        "classification": "advisory",
        "confidence": 1.0,
        "proposed_outcome": "approve",
        "entitlements": {"ai.automation.live": false}
    } with data.sim.automation_config as {"min_confidence": 1.0}
}
