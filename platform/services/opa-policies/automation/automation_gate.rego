package sim.automation

# Threshold read from data.sim.automation_config (data.json loaded by OPA from policies dir).
# To lower: promote a new authz_policy VKAS artifact through draft→approved→active,
# then PUT /v1/data/sim/automation_config {"min_confidence": X} to the OPA data API.
# Falls back to 1.0 (most restrictive) if the data document is absent.
AUTOMATION_MIN_CONFIDENCE := c if {
    c := data.sim.automation_config.min_confidence
} else := 1.0

# HUMAN_REVIEW: adverse outcome guard — do NOT modify without clinical review
ADVERSE_OUTCOMES := {"deny", "partial_deny", "modify"}

default allow := false

allow if {
    # Only advisory-classified results may enter automation
    input.classification == "advisory"

    # Confidence must meet threshold
    input.confidence >= AUTOMATION_MIN_CONFIDENCE

    # Proposed outcome must not be adverse
    not ADVERSE_OUTCOMES[input.proposed_outcome]

    # Automation must be enabled via kill-switch entitlement
    input.entitlements["ai.automation.live"] == true
}

# Reasons for denial (used in audit trail)
deny_reasons contains reason if {
    input.classification != "advisory"
    reason := "classification_not_advisory"
}

deny_reasons contains reason if {
    input.confidence < AUTOMATION_MIN_CONFIDENCE
    reason := "confidence_below_threshold"
}

deny_reasons contains reason if {
    ADVERSE_OUTCOMES[input.proposed_outcome]
    reason := "adverse_outcome_blocked"
}

deny_reasons contains reason if {
    not input.entitlements["ai.automation.live"]
    reason := "automation_not_enabled"
}
