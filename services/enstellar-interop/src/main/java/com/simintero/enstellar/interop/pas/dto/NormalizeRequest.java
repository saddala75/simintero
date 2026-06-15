package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record NormalizeRequest(
    @JsonProperty("bundle") Object bundle,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("correlation_id") String correlationId
) {}
