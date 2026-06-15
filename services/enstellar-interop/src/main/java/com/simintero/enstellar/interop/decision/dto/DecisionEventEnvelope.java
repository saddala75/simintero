package com.simintero.enstellar.interop.decision.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Jackson DTO for the outer EventEnvelope JSON published to "decision.recorded".
 *
 * Matches the Python EventEnvelope schema in packages/event-contracts.
 * Unknown fields are ignored for forward compatibility.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DecisionEventEnvelope(
        @JsonProperty("event_id")       String eventId,
        @JsonProperty("tenant_id")      String tenantId,
        @JsonProperty("case_id")        String caseId,
        @JsonProperty("correlation_id") String correlationId,
        @JsonProperty("type")           String type,
        @JsonProperty("occurred_at")    String occurredAt,
        @JsonProperty("payload")        DecisionRecordedPayload payload,
        @JsonProperty("schema_version") String schemaVersion
) {}
