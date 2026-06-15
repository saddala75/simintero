package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record EventEnvelope(
    @JsonProperty("event_id") UUID eventId,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("case_id") UUID caseId,
    @JsonProperty("correlation_id") String correlationId,
    @JsonProperty("type") String type,
    @JsonProperty("occurred_at") Instant occurredAt,
    @JsonProperty("actor") Actor actor,
    @JsonProperty("payload") Map<String, Object> payload,
    @JsonProperty("schema_version") String schemaVersion
) {}
