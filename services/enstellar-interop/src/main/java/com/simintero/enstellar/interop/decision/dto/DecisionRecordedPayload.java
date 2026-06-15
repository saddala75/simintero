package com.simintero.enstellar.interop.decision.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Jackson DTO for the payload object inside a decision.recorded EventEnvelope.
 *
 * T10 (AutoDeterminator._approve()) emits:
 *   decision_id, outcome, auto_approved, rule_artifact_id, rule_version
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DecisionRecordedPayload(
        @JsonProperty("decision_id")      String decisionId,
        @JsonProperty("outcome")          String outcome,
        @JsonProperty("auto_approved")    Boolean autoApproved,
        @JsonProperty("rule_artifact_id") String ruleArtifactId,
        @JsonProperty("rule_version")     String ruleVersion
) {}
